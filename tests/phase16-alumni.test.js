const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");
const F1 = "11111111-1111-4111-8111-111111111111", F2 = "22222222-2222-4222-8222-222222222222", D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", D2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USERS = { boss: { email: "b@x.com", role: "super_admin" }, ed: { email: "e@x.com", role: "content_admin" }, mod: { email: "m@x.com", role: "moderator" } };
function setup() {
  const api = load({ ...PROVIDERS });
  const db = create({ faculties: [{ id: F1, name: "Engineering" }, { id: F2, name: "Arts" }], departments: [{ id: D1, faculty_id: F1, name: "Civil Engineering" }, { id: D2, faculty_id: F2, name: "Music" }], alumni: [], mentor_requests: [] });
  db.install({}); const inner = global.fetch;
  global.fetch = async (url, opt = {}) => { const tok = String((opt.headers || {}).Authorization || "").replace("Bearer ", ""), u = USERS[tok];
    if (url.includes("/auth/v1/user")) return u ? { ok: true, status: 200, json: async () => ({ id: "x", email: u.email }) } : { ok: false, status: 401, json: async () => ({}) };
    if (url.includes("/rest/v1/admins")) return { ok: true, status: 200, json: async () => (u ? [{ role: u.role }] : []) };
    return inner(url, opt); };
  const router = api("comms/[action].js"); let n = 0;
  return { db, call: async (token, body, ip) => { const r = res(); await router({ method: "POST", query: { action: "alumni" }, headers: { ...(token ? { authorization: "Bearer " + token } : {}), "x-forwarded-for": ip || "5.5.5." + ++n }, body }, r); return r; } };
}
const join = (o = {}) => ({ action: "join", full_name: "Ngozi Eze", graduation_year: 2019, faculty_id: F1, department_id: D1, occupation: "Engineer", location: "Lagos", email: "ngozi@x.com", phone: "08031234567", mentor: true, consent_public: true, ...o });

test("an alumnus joins as pending; the public list shows only approved people and never contact details", async () => {
  const s = setup(); assert.equal((await s.call(null, join())).code, 200);
  assert.equal((await s.call(null, { action: "list" })).body.alumni.length, 0);
  const id = s.db.t.alumni[0].id; assert.equal((await s.call("boss", { action: "admin_set", id, status: "approved" })).code, 200);
  const l = await s.call(null, { action: "list" }); assert.equal(l.body.alumni.length, 1);
  assert.equal(l.body.alumni[0].faculty, "Engineering"); assert.equal(l.body.alumni[0].mentor, true);
  assert.equal(JSON.stringify(l.body).includes("ngozi@x.com"), false); assert.equal(JSON.stringify(l.body).includes("0803"), false);
});
test("joining needs consent, a valid email, a real year and a department from the chosen faculty; duplicates are refused", async () => {
  const s = setup();
  assert.equal((await s.call(null, join({ consent_public: false }))).code, 400);
  assert.equal((await s.call(null, join({ email: "bad" }))).code, 400);
  assert.equal((await s.call(null, join({ graduation_year: 1900 }))).code, 400);
  assert.equal((await s.call(null, join({ department_id: D2 }))).code, 400);
  assert.equal((await s.call(null, join())).code, 200);
  assert.equal((await s.call(null, join({ email: "NGOZI@x.com" }))).code, 409);
});
test("a rejected alumnus is not shown", async () => {
  const s = setup(); await s.call(null, join()); const id = s.db.t.alumni[0].id;
  await s.call("boss", { action: "admin_set", id, status: "rejected" }); assert.equal((await s.call(null, { action: "list" })).body.alumni.length, 0);
});
test("mentor requests reach admins with the faculty's approved mentors listed; the public cannot read them", async () => {
  const s = setup(); await s.call(null, join()); await s.call("boss", { action: "admin_set", id: s.db.t.alumni[0].id, status: "approved" });
  assert.equal((await s.call(null, { action: "mentor_request", faculty_id: F1, message: "Need career advice", name: "Chika", phone: "08031234567" })).code, 200);
  assert.equal((await s.call(null, { action: "mentor_request", faculty_id: F1, message: "x", name: "C", phone: "" })).code, 400);
  const q = await s.call("ed", { action: "req_list" }); assert.equal(q.body.requests.length, 1); assert.equal(q.body.requests[0].mentors[0].email, "ngozi@x.com");
  const id = s.db.t.mentor_requests[0].id; assert.equal((await s.call("ed", { action: "req_set", id, status: "matched", note: "Introduced" })).code, 200);
  assert.equal(s.db.t.mentor_requests[0].status, "matched");
  assert.equal((await s.call(null, { action: "req_list" })).code, 401);
});
test("only super and content admins manage alumni; moderators and anonymous users cannot", async () => {
  const s = setup(); await s.call(null, join());
  assert.equal((await s.call("mod", { action: "admin_list" })).code, 403); assert.equal((await s.call(null, { action: "admin_list" })).code, 401);
  assert.equal((await s.call("ed", { action: "admin_list" })).body.alumni[0].email, "ngozi@x.com");
  assert.equal((await s.call("ed", { action: "admin_delete", id: s.db.t.alumni[0].id })).code, 200); assert.equal(s.db.t.alumni.length, 0);
});
test("sign-ups are rate limited per address", async () => {
  const s = setup(); let last; for (let i = 0; i < 6; i++) last = await s.call(null, join({ email: `p${i}@x.com` }), "7.7.7.7");
  assert.equal(last.code, 429);
});
