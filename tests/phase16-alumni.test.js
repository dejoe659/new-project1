const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");
const nodemailer = require("nodemailer");
const F1 = "11111111-1111-4111-8111-111111111111", F2 = "22222222-2222-4222-8222-222222222222", D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", D2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USERS = { boss: { email: "b@x.com", role: "super_admin" }, ed: { email: "e@x.com", role: "content_admin" }, mod: { email: "m@x.com", role: "moderator" } };
function setup() {
  const sent = []; nodemailer.createTransport = () => ({ sendMail: async (m) => { sent.push(m); } });
  const api = load({ ...PROVIDERS, GMAIL_USER: "f@x.com", GMAIL_APP_PASSWORD: "pw" });
  const db = create({ faculties: [{ id: F1, name: "Engineering" }, { id: F2, name: "Arts" }], departments: [{ id: D1, faculty_id: F1, name: "Civil Engineering" }, { id: D2, faculty_id: F2, name: "Music" }], alumni: [], mentor_requests: [] });
  db.install({}); const inner = global.fetch;
  global.fetch = async (url, opt = {}) => { const tok = String((opt.headers || {}).Authorization || "").replace("Bearer ", ""), u = USERS[tok];
    if (url.includes("/auth/v1/user")) return u ? { ok: true, status: 200, json: async () => ({ id: "x", email: u.email }) } : { ok: false, status: 401, json: async () => ({}) };
    if (url.includes("/rest/v1/admins")) return { ok: true, status: 200, json: async () => (u ? [{ role: u.role }] : []) };
    return inner(url, opt); };
  const router = api("comms/[action].js"); let n = 0;
  return { sent, db, call: async (token, body, ip) => { const r = res(); await router({ method: "POST", query: { action: "alumni" }, headers: { ...(token ? { authorization: "Bearer " + token } : {}), "x-forwarded-for": ip || "5.5.5." + ++n }, body }, r); return r; } };
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

test("approving an alumnus emails them once; rejecting or re-approving sends nothing more", async () => {
  const s = setup(); await s.call(null, join()); const id = s.db.t.alumni[0].id;
  await s.call("boss", { action: "admin_set", id, status: "approved" });
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].to, "ngozi@x.com"); assert.match(s.sent[0].text, /willing to mentor/);
  await s.call("boss", { action: "admin_set", id, status: "approved" }); await s.call("boss", { action: "admin_set", id, mentor: false });
  assert.equal(s.sent.length, 1);
});
test("introducing a mentor emails both people, marks the request matched, and checks the mentor is approved and in the same faculty", async () => {
  const s = setup(); await s.call(null, join()); await s.call(null, join({ email: "other@x.com", faculty_id: F2, department_id: D2, full_name: "Arts Person" }));
  const [m1, m2] = s.db.t.alumni.map((a) => a.id); await s.call("boss", { action: "admin_set", id: m1, status: "approved" }); await s.sent.splice(0);
  await s.call(null, { action: "mentor_request", faculty_id: F1, message: "Need career advice", name: "Chika", phone: "08031234567", email: "chika@x.com" });
  const rid = s.db.t.mentor_requests[0].id;
  assert.equal((await s.call("ed", { action: "req_introduce", id: rid, alumni_id: m2 })).code, 400);   // not approved, other faculty
  assert.equal(s.sent.length, 0);
  const r = await s.call("ed", { action: "req_introduce", id: rid, alumni_id: m1 });
  assert.equal(r.code, 200); assert.equal(r.body.student_emailed, true);
  const to = s.sent.map((m) => m.to).sort(); assert.deepEqual(to, ["chika@x.com", "ngozi@x.com"]);
  assert.match(s.sent.find((m) => m.to === "ngozi@x.com").text, /08031234567/);
  assert.equal(s.sent.find((m) => m.to === "chika@x.com").text.includes("ngozi@x.com"), false, "the mentor's contact is not given to the student");
  assert.equal(s.db.t.mentor_requests[0].status, "matched");
});
test("a failed mentor email records nothing", async () => {
  const s = setup(); await s.call(null, join()); await s.call("boss", { action: "admin_set", id: s.db.t.alumni[0].id, status: "approved" });
  await s.call(null, { action: "mentor_request", faculty_id: F1, message: "Need help please", name: "Chika", phone: "08031234567" });
  nodemailer.createTransport = () => ({ sendMail: async () => { throw new Error("smtp down"); } });
  const r = await s.call("boss", { action: "req_introduce", id: s.db.t.mentor_requests[0].id, alumni_id: s.db.t.alumni[0].id });
  assert.equal(r.code, 502); assert.notEqual(s.db.t.mentor_requests[0].status, "matched");
});
