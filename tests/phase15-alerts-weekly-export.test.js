const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

const F1 = "11111111-1111-4111-8111-111111111111", F2 = "22222222-2222-4222-8222-222222222222", D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USERS = { boss: { email: "b@x.com", role: "super_admin" }, ed: { email: "e@x.com", role: "content_admin" } };
function setup(seed = {}) {
  const sent = []; nodemailer.createTransport = () => ({ sendMail: async (m) => { sent.push(m); } });
  const api = load({ ...PROVIDERS, GMAIL_USER: "fellowship@x.com", GMAIL_APP_PASSWORD: "pw", CRON_SECRET: "cron" });
  const db = create({
    faculties: [{ id: F1, name: "Engineering" }, { id: F2, name: "Arts" }], departments: [{ id: D1, faculty_id: F1, name: "Civil Engineering" }],
    academic_coordinators: [
      { id: "c1", email: "eng@x.com", faculty_ids: [F1], active: true }, { id: "c2", email: "arts@x.com", faculty_ids: [F2], active: true }, { id: "c3", email: "off@x.com", faculty_ids: [F1], active: false }],
    academic_requests: [], admin_audit_logs: [], members: [], attendance: [], care_requests: [], events: [], message_queue: [], ...seed });
  db.install({}); const inner = global.fetch;
  global.fetch = async (url, opt = {}) => { const tok = String((opt.headers || {}).Authorization || "").replace("Bearer ", ""), u = USERS[tok];
    if (url.includes("/auth/v1/user")) return u ? { ok: true, status: 200, json: async () => ({ id: "x", email: u.email }) } : { ok: false, status: 401, json: async () => ({}) };
    if (url.includes("/rest/v1/admins")) return { ok: true, status: 200, json: async () => (u ? [{ role: u.role }] : []) };
    return inner(url, opt); };
  return { api, db, sent };
}
const rq = (token, query) => ({ method: "GET", query, headers: token ? { authorization: "Bearer " + token } : {} });

test("an academic request emails the fellowship inbox and that faculty's active coordinators only, with no student details", async () => {
  const s = setup(); const router = s.api("comms/[action].js"); const r = res();
  await router({ method: "POST", query: { action: "academic" }, headers: { "x-forwarded-for": "9.9.9.9" }, body: { action: "submit", faculty_id: F1, department_id: D1, course: "CVE 301", issue: "PRIVATE PROBLEM TEXT", name: "Secret Student", phone: "08031234567" } }, r);
  assert.equal(r.code, 200);
  const to = s.sent.map((m) => m.to).sort(); assert.deepEqual(to, ["eng@x.com", "fellowship@x.com"]);
  assert.equal(JSON.stringify(s.sent).includes("PRIVATE"), false); assert.equal(JSON.stringify(s.sent).includes("Secret Student"), false);
});
test("weekly summary counts things and contains no names", async () => {
  const s = setup({ members: [{ id: "m1", full_name: "Hidden Name", review_status: "pending", created_at: new Date().toISOString() }], care_requests: [{ id: "q", status: "new", message: "HIDDEN" }], attendance: [{ id: "a", created_at: new Date().toISOString() }] });
  const weekly = s.api("_comms/weekly.js"); const out = await weekly.run();
  assert.equal(out.newMembers, 1); assert.equal(out.pending, 1); assert.equal(out.careOpen, 1);
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].to, "fellowship@x.com"); assert.match(s.sent[0].text, /Registrations waiting for approval: 1/);
  assert.equal(/Hidden|HIDDEN/.test(s.sent[0].text), false);
});
test("the weekly summary is due on Monday in Lagos only", async () => {
  const w = setup().api("_comms/weekly.js");
  assert.equal(w.isMondayInLagos(Date.parse("2026-11-23T07:00:00Z")), true);
  assert.equal(w.isMondayInLagos(Date.parse("2026-11-22T23:30:00Z")), true);   // Monday 00:30 in Lagos
  assert.equal(w.isMondayInLagos(Date.parse("2026-11-24T07:00:00Z")), false);
});
test("only a super admin can download a backup; spreadsheet formulas are neutralised; care data is not exportable", async () => {
  const s = setup({ members: [{ id: "m1", full_name: "=HYPERLINK(\"http://evil\")", email: "a@x.com", created_at: new Date().toISOString() }, { id: "m2", full_name: "Plain, Name", created_at: new Date().toISOString() }] });
  const router = s.api("comms/[action].js");
  let r = res(); await router(rq("ed", { action: "export", table: "members" }), r); assert.equal(r.code, 403);
  r = res(); await router(rq(null, { action: "export", table: "members" }), r); assert.equal(r.code, 401);
  r = res(); await router(rq("boss", { action: "export", table: "care_requests" }), r); assert.equal(r.code, 400);
  r = res(); await router(rq("boss", { action: "export", table: "members" }), r); assert.equal(r.code, 200);
  assert.ok(String(r.body).includes("'=HYPERLINK")); assert.ok(String(r.body).includes('"Plain, Name"'));
  assert.ok(s.db.t.admin_audit_logs.some((l) => l.action === "export.members"));
});
