const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

const ENV = { ...PROVIDERS, GMAIL_USER: "dcf@gmail.com", GMAIL_APP_PASSWORD: "x", UNSUBSCRIBE_SECRET: "u", SITE_URL: "https://dcf.test", CRON_SECRET: "cron-secret" };
const EID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1";
const hours = (h) => new Date(Date.now() + h * 36e5).toISOString();
const ev = (o = {}) => ({ id: EID, title: "Youth Retreat", date: "x", venue: "Lecture Hall", details: "Come", starts_at: hours(30), poster_url: null, capacity: null, registration_open: true, ...o });
const transport = () => { const sent = []; return { sent, sendMail: async (m) => { sent.push(m); return { messageId: "<m>", accepted: [m.to], rejected: [] }; } }; };

function setup({ events = [ev()], registrations = [], testMode = { enabled: false, recipients: [] } } = {}) {
  const api = load(ENV);
  const db = create({ events, event_registrations: registrations, members: [], member_preferences: [], communication_settings: [{ key: "test_mode", value: testMode }] });
  db.install({});
  const mailer = transport();
  api("_comms/providers/gmail.js")._setTransport(mailer);
  const router = api("comms/[action].js");
  const call = async (body) => { const r = res(); await router({ method: "POST", query: { action: "events" }, headers: {}, body }, r); return r; };
  const cron = async () => { const r = res(); await router({ method: "GET", query: { action: "queue-run" }, headers: { authorization: "Bearer cron-secret" } }, r); return r; };
  return { db, mailer, call, cron, router };
}
const reg = (o = {}) => ({ action: "register", event_id: EID, full_name: "Ada Obi", phone: "08031234567", ...o });

test("the public list splits upcoming and past events and never shows registrants", async () => {
  const s = setup({ events: [ev(), ev({ id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2", title: "Old", starts_at: hours(-48) }), ev({ id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3", title: "No date", starts_at: null })],
    registrations: [{ id: "r1", event_id: EID, full_name: "Secret Name", phone: "1", phone_key: "1", email: "s@x.com" }] });
  const r = await s.call({ action: "list" });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.upcoming.map((e) => e.title), ["Youth Retreat"]);
  assert.deepEqual(r.body.past.map((e) => e.title), ["Old"]);
  assert.equal(JSON.stringify(r.body).includes("Secret Name"), false);
  assert.equal(JSON.stringify(r.body).includes("s@x.com"), false);
});

test("a person can register, and is stored with a normalised phone number", async () => {
  const s = setup();
  const r = await s.call(reg({ email: "Ada@X.com", agree: true }));
  assert.equal(r.code, 200);
  assert.match(r.body.message, /reminder/);
  const row = s.db.t.event_registrations[0];
  assert.deepEqual([row.full_name, row.phone_key, row.email], ["Ada Obi", "2348031234567", "ada@x.com"]);
});

test("the same phone number cannot register twice, however it is typed", async () => {
  const s = setup();
  await s.call(reg());
  for (const phone of ["08031234567", "+234 803 123 4567", "2348031234567"]) {
    const r = await s.call(reg({ phone }));
    assert.equal(r.code, 409, phone);
  }
  assert.equal(s.db.t.event_registrations.length, 1);
});

test("the registration limit is enforced", async () => {
  const s = setup({ events: [ev({ capacity: 2 })] });
  assert.equal((await s.call(reg({ phone: "08031111111" }))).code, 200);
  assert.equal((await s.call(reg({ phone: "08032222222" }))).code, 200);
  const r = await s.call(reg({ phone: "08033333333" }));
  assert.equal(r.code, 409);
  assert.match(r.body.error, /full/i);
  assert.equal(s.db.t.event_registrations.length, 2);
  const list = await s.call({ action: "list" });
  assert.equal(list.body.upcoming[0].spots_left, 0);
  assert.equal(list.body.upcoming[0].can_register, false);
});

test("closed, past, unknown and undated events cannot be registered for", async () => {
  for (const [events, id, code] of [
    [[ev({ registration_open: false })], EID, 409],
    [[ev({ starts_at: hours(-1) })], EID, 409],
    [[ev({ starts_at: null })], EID, 409],
    [[ev()], "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee9", 404],
    [[ev()], "not-a-uuid", 400],
  ]) {
    const s = setup({ events });
    assert.equal((await s.call(reg({ event_id: id }))).code, code, String(id));
    assert.equal(s.db.t.event_registrations.length, 0);
  }
});

test("bad input is refused; an email needs the agreement tick; the honeypot drops bots", async () => {
  const s = setup();
  assert.equal((await s.call(reg({ full_name: "A" }))).code, 400);
  assert.equal((await s.call(reg({ phone: "123" }))).code, 400);
  assert.equal((await s.call(reg({ email: "nope" }))).code, 400);
  assert.equal((await s.call(reg({ email: "a@x.com" }))).code, 400, "email without agreeing");
  const bot = await s.call(reg({ website: "http://spam" }));
  assert.equal(bot.code, 200);
  assert.equal(s.db.t.event_registrations.length, 0);
  assert.equal((await s.call({ action: "drop" })).code, 400);
});

test("a reminder email goes once to each registrant with an email, before the event", async () => {
  const s = setup({ registrations: [
    { id: "r1", event_id: EID, full_name: "Ada Obi", phone: "1", phone_key: "1", email: "ada@x.com" },
    { id: "r2", event_id: EID, full_name: "Bayo Ade", phone: "2", phone_key: "2", email: null },
    { id: "r3", event_id: EID, full_name: "Chi Eze", phone: "3", phone_key: "3", email: "chi@x.com" }] });
  s.db.t.contact_suppressions.push({ channel: "email", address: "chi@x.com" });
  await s.cron(); await s.cron();
  assert.equal(s.mailer.sent.length, 1);
  assert.equal(s.mailer.sent[0].to, "ada@x.com");
  assert.match(s.mailer.sent[0].subject, /Reminder: Youth Retreat/);
  assert.match(s.mailer.sent[0].text, /Hello Ada,/);
  assert.ok(s.mailer.sent[0].headers["List-Unsubscribe"]);
});

test("no reminder for events far away or already started, and none in test mode", async () => {
  const regs = (id) => [{ id: "r1", event_id: id, full_name: "Ada", phone: "1", phone_key: "1", email: "ada@x.com" }];
  const far = setup({ events: [ev({ starts_at: hours(100) })], registrations: regs(EID) }); await far.cron();
  const gone = setup({ events: [ev({ starts_at: hours(-2) })], registrations: regs(EID) }); await gone.cron();
  const t = setup({ registrations: regs(EID), testMode: { enabled: true, recipients: [] } }); await t.cron();
  assert.equal(far.mailer.sent.length + gone.mailer.sent.length + t.mailer.sent.length, 0);
});

test("a registrant's unsubscribe link stops emails to their address", async () => {
  const s = setup({ registrations: [{ id: "r1", event_id: EID, full_name: "Ada", phone: "1", phone_key: "1", email: "ada@x.com" }] });
  await s.cron();
  const t = /unsubscribe\?t=([^>]+)/.exec(s.mailer.sent[0].headers["List-Unsubscribe"])[1];
  const r = res();
  await s.router({ method: "POST", query: { action: "unsubscribe", t }, headers: {}, body: {} }, r);
  assert.equal(r.code, 200);
  assert.ok(s.db.t.contact_suppressions.some((x) => x.address === "ada@x.com" && x.channel === "email"));
});
