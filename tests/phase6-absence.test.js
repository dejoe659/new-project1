const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

const ENV = { ...PROVIDERS, GMAIL_USER: "dcf@gmail.com", GMAIL_APP_PASSWORD: "x", UNSUBSCRIBE_SECRET: "u", SITE_URL: "https://dcf.test", CRON_SECRET: "cron-secret" };
const id = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const sid = (n) => `55555555-5555-5555-5555-55555555555${n}`;
const day = (back) => new Date(Date.now() + 36e5 - back * 864e5).toISOString().slice(0, 10);
const member = (n, o = {}) => ({ id: id(n), full_name: `Ada${n} Obi`, email: `m${n}@x.com`, phone: `0803333444${n}`, level: "100", department: "Law", review_status: "approved", created_at: "2020-01-01T00:00:00Z", ...o });
const pref = (n, o = {}) => ({ member_id: id(n), sms_opt_in: false, email_opt_in: true, whatsapp_opt_in: false, opted_out: false, ...o });
const transport = () => { const sent = []; return { sent, sendMail: async (m) => { sent.push(m); return { messageId: "<m" + sent.length + ">", accepted: [m.to], rejected: [] }; } }; };

function setup({ members, prefs, sessions, attendance = [], rule = { mode: "automatic", channels: ["email"] }, mail } = {}) {
  const api = load(ENV);
  const db = create({ members, member_preferences: prefs, sessions, attendance, automation_rules: [{ key: "absent_followup", ...rule }], communication_settings: [{ key: "test_mode", value: { enabled: false, recipients: [] } }] });
  db.install({});
  const mailer = mail || transport();
  api("_comms/providers/gmail.js")._setTransport(mailer);
  const router = api("comms/[action].js");
  const cron = async () => { const r = res(); await router({ method: "GET", query: { action: "queue-run" }, headers: { authorization: "Bearer cron-secret" } }, r); return r; };
  return { db, mailer, cron };
}
const base = () => ({
  members: [member(1), member(2), member(3)], prefs: [pref(1), pref(2), pref(3)],
  sessions: [{ id: sid(1), kind: "Celebration Service", session_date: day(1) }],
  attendance: [{ session_id: sid(1), member_id: id(1) }],
});

test("absent members get their own message by name; people who came do not", async () => {
  const s = setup(base());
  const r = await s.cron();
  assert.equal(r.code, 200);
  assert.equal(r.body.followUp.queued, 2);
  assert.equal(s.mailer.sent.length, 2);
  const to = s.mailer.sent.map((m) => m.to).sort();
  assert.deepEqual(to, ["m2@x.com", "m3@x.com"]);
  const m2 = s.mailer.sent.find((m) => m.to === "m2@x.com");
  assert.match(m2.text, /Hello Ada2,/);
  assert.match(m2.text, /Celebration Service/);
  assert.equal(m2.replyTo, "dcf@gmail.com");
  assert.ok(m2.headers["List-Unsubscribe"]);
});

test("running the job again never messages anyone twice about the same service", async () => {
  const s = setup(base());
  await s.cron(); await s.cron(); await s.cron();
  assert.equal(s.mailer.sent.length, 2);
});

test("each service is followed up separately", async () => {
  const b = base();
  b.sessions.push({ id: sid(2), kind: "Prayer Meeting", session_date: day(2) });
  const s = setup(b);
  await s.cron();
  assert.equal(s.mailer.sent.filter((m) => m.to === "m2@x.com").length, 2, "member 2 missed two different services");
  assert.equal(s.mailer.sent.filter((m) => m.to === "m1@x.com").length, 1, "member 1 only missed the second one");
});

test("does nothing unless the rule is switched to automatic", async () => {
  for (const rule of [{ mode: "disabled", channels: ["email"] }, { mode: "approval", channels: ["email"] }]) {
    const s = setup({ ...base(), rule });
    const r = await s.cron();
    assert.equal(r.body.followUp.enabled, false);
    assert.equal(s.mailer.sent.length, 0);
  }
});

test("skips today's service, old services, people who joined later, and people without consent", async () => {
  const b = base();
  b.sessions = [{ id: sid(1), kind: "A", session_date: day(0) }, { id: sid(2), kind: "B", session_date: day(10) }, { id: sid(3), kind: "C", session_date: day(1) }];
  b.attendance = [];
  b.members = [member(1), member(2, { created_at: new Date().toISOString() }), member(3)];
  b.prefs = [pref(1), pref(2), pref(3, { opted_out: true })];
  const s = setup(b);
  const r = await s.cron();
  assert.equal(r.body.followUp.sessions, 1);
  assert.deepEqual(s.mailer.sent.map((m) => m.to), ["m1@x.com"]);
});

test("a failure in the follow-up step does not stop the rest of the daily job", async () => {
  const s = setup(base());
  const orig = global.fetch;
  global.fetch = async (url, opt) => (String(url).includes("automation_rules") ? { ok: false, status: 500, json: async () => ({}), text: async () => "x" } : orig(url, opt));
  const r = await s.cron();
  assert.equal(r.code, 200);
  assert.equal(r.body.followUp.error, true);
});
