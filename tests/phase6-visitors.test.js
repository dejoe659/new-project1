const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

const ENV = { ...PROVIDERS, GMAIL_USER: "dcf@gmail.com", GMAIL_APP_PASSWORD: "x", UNSUBSCRIBE_SECRET: "u", SITE_URL: "https://dcf.test", CRON_SECRET: "cron-secret" };
const SID = "55555555-5555-5555-5555-555555555551";
const now = () => new Date().toISOString();
const visit = (n, o = {}) => ({ id: `aaaaaaaa-0000-0000-0000-00000000000${n}`, session_id: SID, member_id: null, visitor_name: `Tunde${n} Bello`, visitor_phone: `0803333444${n}`, visitor_email: `v${n}@x.com`, visitor_email_consent: true, created_at: now(), ...o });
const transport = () => { const sent = []; return { sent, sendMail: async (m) => { sent.push(m); return { messageId: "<m>", accepted: [m.to], rejected: [] }; } }; };

function setup({ attendance, rule = { mode: "automatic", channels: ["email"] }, testMode = { enabled: false, recipients: [] } }) {
  const api = load(ENV);
  const db = create({ members: [], member_preferences: [], sessions: [{ id: SID, kind: "Celebration Service", session_date: new Date().toISOString().slice(0, 10), code: "1234", is_open: true }],
    attendance, automation_rules: [{ key: "visitor_followup", ...rule }, { key: "absent_followup", mode: "disabled", channels: [] }], communication_settings: [{ key: "test_mode", value: testMode }] });
  db.install({});
  const mailer = transport();
  api("_comms/providers/gmail.js")._setTransport(mailer);
  const router = api("comms/[action].js");
  const cron = async () => { const r = res(); await router({ method: "GET", query: { action: "queue-run" }, headers: { authorization: "Bearer cron-secret" } }, r); return r; };
  const checkin = async (phone) => { const r = res(); await api("visitor-thanks.js")({ method: "POST", body: { code: "1234", phone } }, r); return r; };
  return { db, mailer, cron, checkin, router };
}

test("right after check-in a visitor who gave an email gets a personal welcome", async () => {
  const s = setup({ attendance: [visit(1)] });
  await s.checkin("08033334441");
  assert.equal(s.mailer.sent.length, 1);
  assert.equal(s.mailer.sent[0].to, "v1@x.com");
  assert.match(s.mailer.sent[0].subject, /Welcome to Dunamis Campus Fellowship, Tunde1!/);
  assert.match(s.mailer.sent[0].text, /Hello Tunde1,/);
  assert.ok(s.mailer.sent[0].headers["List-Unsubscribe"], "visitors can unsubscribe too");
});

test("the daily job is a safety net and never doubles up", async () => {
  const s = setup({ attendance: [visit(1), visit(2)] });
  await s.checkin("08033334441");
  await s.cron(); await s.cron();
  assert.deepEqual(s.mailer.sent.map((m) => m.to).sort(), ["v1@x.com", "v2@x.com"]);
});

test("a returning visitor is welcomed only once per email address", async () => {
  const s = setup({ attendance: [visit(1), visit(2, { visitor_email: "v1@x.com" })] });
  await s.cron();
  assert.equal(s.mailer.sent.length, 1);
});

test("no consent tick, no email address, or rule off means no email", async () => {
  const s = setup({ attendance: [visit(1, { visitor_email_consent: false }), visit(2, { visitor_email: null })] });
  await s.cron();
  assert.equal(s.mailer.sent.length, 0);
  const off = setup({ attendance: [visit(1)], rule: { mode: "disabled", channels: ["email"] } });
  await off.cron(); await off.checkin("08033334441");
  assert.equal(off.mailer.sent.length, 0);
});

test("opted-out addresses and test mode are respected", async () => {
  const s = setup({ attendance: [visit(1)] });
  s.db.t.contact_suppressions.push({ channel: "email", address: "v1@x.com" });
  await s.cron();
  assert.equal(s.mailer.sent.length, 0);
  const t = setup({ attendance: [visit(1)], testMode: { enabled: true, recipients: [] } });
  await t.cron();
  assert.equal(t.mailer.sent.length, 0);
});

test("a visitor's unsubscribe link stops emails to their address", async () => {
  const s = setup({ attendance: [visit(1)] });
  await s.checkin("08033334441");
  const url = /unsubscribe\?t=([^>]+)/.exec(s.mailer.sent[0].headers["List-Unsubscribe"])[1];
  const r = res();
  await s.router({ method: "POST", query: { action: "unsubscribe", t: url }, headers: {}, body: {} }, r);
  assert.equal(r.code, 200);
  assert.ok(s.db.t.contact_suppressions.some((x) => x.address === "v1@x.com" && x.channel === "email"));
});
