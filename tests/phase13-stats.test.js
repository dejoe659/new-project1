const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");
const USERS = { boss: { email: "b@x.com", role: "super_admin" }, ed: { email: "e@x.com", role: "content_admin" }, none: { email: "n@x.com", role: null } };
function setup() {
  const api = load({ ...PROVIDERS }); const now = new Date().toISOString();
  const db = create({
    members: [{ id: "m1", review_status: "approved", department: "Choir", level: "200", created_at: now, profile_approved: true }, { id: "m2", review_status: "pending", department: "Choir", level: "100", created_at: now }],
    attendance: [{ member_id: "m1", created_at: now }, { member_id: null, created_at: now }], events: [{ id: "e1", starts_at: new Date(Date.now() + 864e5).toISOString() }], event_registrations: [{ attended: true }, { attended: false }],
    testimonies: [{ status: "approved" }], message_queue: [{ status: "sent", category: "welcome" }],
    care_requests: [{ kind: "prayer", status: "new", message: "SECRET TEXT" }], academic_requests: [{ faculty_id: "f1", status: "new", issue: "SECRET ISSUE" }], faculties: [{ id: "f1", name: "Arts" }] });
  db.install({}); const inner = global.fetch;
  global.fetch = async (url, opt = {}) => { const tok = String((opt.headers || {}).Authorization || "").replace("Bearer ", ""), u = USERS[tok];
    if (url.includes("/auth/v1/user")) return u ? { ok: true, status: 200, json: async () => ({ id: "x", email: u.email }) } : { ok: false, status: 401, json: async () => ({}) };
    if (url.includes("/rest/v1/admins")) return { ok: true, status: 200, json: async () => (u && u.role ? [{ role: u.role }] : []) };
    return inner(url, opt); };
  const router = api("comms/[action].js");
  return async (token) => { const r = res(); await router({ method: "GET", query: { action: "stats" }, headers: token ? { authorization: "Bearer " + token } : {} }, r); return r; };
}
test("stats need an administrator", async () => { const c = setup(); assert.equal((await c(null)).code, 401); assert.equal((await c("none")).code, 403); });
test("a content admin gets counts but not care or academic numbers", async () => {
  const r = await setup()("ed"); assert.equal(r.code, 200);
  assert.equal(r.body.members.total, 2); assert.equal(r.body.members.by_department.Choir, 2); assert.equal(r.body.members.by_review.pending, 1);
  assert.equal(r.body.care, undefined); assert.equal(r.body.academic, undefined);
  const wk = r.body.attendance.weeks; assert.equal(wk.length, 8); assert.equal(wk[7].members, 1); assert.equal(wk[7].visitors, 1);
  assert.equal(r.body.events.upcoming, 1); assert.equal(r.body.events.attended, 1);
});
test("a super admin also gets care and academic counts, never any text", async () => {
  const r = await setup()("boss"); assert.equal(r.body.care.by_kind.prayer, 1); assert.equal(r.body.academic.by_faculty.Arts, 1);
  assert.equal(JSON.stringify(r.body).includes("SECRET"), false);
});
