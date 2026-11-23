const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

const F1 = "11111111-1111-4111-8111-111111111111", F2 = "22222222-2222-4222-8222-222222222222", D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", D2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USERS = { boss: { email: "boss@x.com", role: "super_admin" }, eng: { email: "eng@x.com", role: null }, nobody: { email: "no@x.com", role: null }, content: { email: "c@x.com", role: "content_admin" } };

function setup() {
  const api = load({ ...PROVIDERS });
  const db = create({
    faculties: [{ id: F1, name: "Engineering" }, { id: F2, name: "Arts" }],
    departments: [{ id: D1, faculty_id: F1, name: "Civil Engineering" }, { id: D2, faculty_id: F2, name: "Music" }],
    academic_coordinators: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "eng@x.com", name: "Eng Lead", faculty_ids: [F1], can_view_contact: true, can_update: true, active: true }],
    academic_requests: [], admin_audit_logs: [],
  });
  db.install({});
  const inner = global.fetch; const created = [], resets = [];
  global.fetch = async (url, opt = {}) => {
    const tok = String((opt.headers || {}).Authorization || "").replace("Bearer ", ""), u = USERS[tok];
    if (url.includes("/auth/v1/user")) return u ? { ok: true, status: 200, json: async () => ({ id: "uid-" + tok, email: u.email }) } : { ok: false, status: 401, json: async () => ({}) };
    if (/\/auth\/v1\/admin\/users\?/.test(url)) return { ok: true, status: 200, json: async () => ({ users: [{ id: "user-eng", email: "Eng@x.com" }] }) };
    if (/\/auth\/v1\/admin\/users\/user-eng/.test(url) && opt.method === "PUT") { resets.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    if (url.includes("/auth/v1/admin/users")) { const b = JSON.parse(opt.body); if (b.email === "exists@x.com") return { ok: false, status: 422, json: async () => ({}) }; created.push(b); return { ok: true, status: 200, json: async () => ({ id: "new" }) }; }
    if (url.includes("/rest/v1/admins")) return { ok: true, status: 200, json: async () => (u && u.role ? [{ role: u.role }] : []) };
    return inner(url, opt);
  };
  const router = api("comms/[action].js"); let ip = 0;
  const call = async (token, body, ipAddr) => { const r = res(); await router({ method: "POST", query: { action: "academic" }, headers: { ...(token ? { authorization: "Bearer " + token } : {}), "x-forwarded-for": ipAddr || "8.8.8." + ++ip }, body }, r); return r; };
  return { db, call, created, resets };
}
const help = (o = {}) => ({ action: "submit", faculty_id: F1, department_id: D1, course: "CVE 301", level: "300", issue: "I do not understand structures.", name: "Ada", phone: "08031234567", ...o });

test("a student submits help for a faculty and department and gets a one-time code", async () => {
  const s = setup(); const r = await s.call(null, help());
  assert.equal(r.code, 200); assert.match(r.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(JSON.stringify(s.db.t.academic_requests[0]).includes(r.body.code.replace(/-/g, "")), false);
  const st = await s.call(null, { action: "status", code: r.body.code });
  assert.equal(st.body.status, "Received"); assert.equal(JSON.stringify(st.body).includes("structures"), false);
});
test("a department from another faculty, no contact, or a missing course is refused", async () => {
  const s = setup();
  assert.equal((await s.call(null, help({ department_id: D2 }))).code, 400);
  assert.equal((await s.call(null, help({ phone: "", email: "" }))).code, 400);
  assert.equal((await s.call(null, help({ course: "" }))).code, 400);
  assert.equal((await s.call(null, help({ faculty_id: "nope" }))).code, 400);
});
test("the public can list faculties with departments", async () => {
  const s = setup(); const r = await s.call(null, { action: "faculties" });
  assert.equal(r.body.faculties.length, 2); assert.equal(r.body.faculties[0].departments.length, 1);
});
test("hourly limit stops floods from one address", async () => {
  const s = setup(); let last;
  for (let i = 0; i < 6; i++) last = await s.call(null, help(), "7.7.7.7");
  assert.equal(last.code, 429);
});
test("a coordinator sees only their own faculty; another faculty's request looks like it does not exist", async () => {
  const s = setup(); await s.call(null, help()); await s.call(null, help({ faculty_id: F2, department_id: D2, course: "MUS 101" }));
  const l = await s.call("eng", { action: "list" });
  assert.equal(l.body.requests.length, 1); assert.equal(l.body.requests[0].faculty, "Engineering");
  const other = s.db.t.academic_requests.find((r) => r.faculty_id === F2);
  assert.equal((await s.call("eng", { action: "get", id: other.id })).code, 404);
  assert.equal((await s.call("eng", { action: "update", id: other.id, status: "closed" })).code, 404);
  assert.equal((await s.call("boss", { action: "list" })).body.requests.length, 2);
});
test("people with no coordinator access, and content admins, are refused", async () => {
  const s = setup(); await s.call(null, help());
  assert.equal((await s.call("nobody", { action: "list" })).code, 403);
  assert.equal((await s.call("content", { action: "list" })).code, 403);
  assert.equal((await s.call(null, { action: "list" })).code, 403);
});
test("access flags decide what a coordinator can do", async () => {
  const s = setup(); await s.call(null, help()); const id = s.db.t.academic_requests[0].id;
  s.db.t.academic_coordinators[0].can_view_contact = false;
  const g = await s.call("eng", { action: "get", id });
  assert.equal(g.body.request.phone, undefined); assert.equal(g.body.request.contact_hidden, true);
  s.db.t.academic_coordinators[0].can_update = false;
  assert.equal((await s.call("eng", { action: "update", id, status: "resolved" })).code, 403);
  s.db.t.academic_coordinators[0].can_update = true; s.db.t.academic_coordinators[0].active = false;
  assert.equal((await s.call("eng", { action: "list" })).code, 403);
});
test("a coordinator can update status and note; viewing and updating are audited without the issue text", async () => {
  const s = setup(); await s.call(null, help()); const id = s.db.t.academic_requests[0].id;
  assert.equal((await s.call("eng", { action: "update", id, status: "resolved", coordinator_note: "Met them" })).code, 200);
  assert.equal(s.db.t.academic_requests[0].status, "resolved");
  await s.call("eng", { action: "get", id });
  assert.equal(JSON.stringify(s.db.t.admin_audit_logs).includes("structures"), false); assert.ok(s.db.t.admin_audit_logs.length >= 2);
});
test("only a super administrator manages coordinators; a coordinator cannot", async () => {
  const s = setup();
  assert.equal((await s.call("eng", { action: "coord_add", email: "n@x.com", faculty_ids: [F1] })).code, 403);
  assert.equal((await s.call("eng", { action: "coords" })).code, 403);
  const a = await s.call("boss", { action: "coord_add", email: "New@x.com", name: "N", faculty_ids: [F2], can_update: false });
  assert.equal(a.code, 200); assert.equal(a.body.login_created, true); assert.match(a.body.temp_password, /^[A-Z2-9]{4}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(s.created[0].email, "new@x.com"); assert.equal(s.created[0].email_confirm, true);
  const row = s.db.t.academic_coordinators.find((c) => c.email === "new@x.com");
  assert.equal(row.can_update, false); assert.deepEqual(row.faculty_ids, [F2]);
  assert.equal(JSON.stringify(s.db.t).includes(a.body.temp_password), false, "password is never stored");
});
test("adding a coordinator needs a real faculty; an existing login is reused; duplicates are refused", async () => {
  const s = setup();
  assert.equal((await s.call("boss", { action: "coord_add", email: "a@x.com", faculty_ids: [] })).code, 400);
  assert.equal((await s.call("boss", { action: "coord_add", email: "a@x.com", faculty_ids: ["bad"] })).code, 400);
  const e = await s.call("boss", { action: "coord_add", email: "exists@x.com", faculty_ids: [F1] });
  assert.equal(e.body.login_created, false); assert.equal(e.body.temp_password, null);
  assert.equal((await s.call("boss", { action: "coord_add", email: "eng@x.com", faculty_ids: [F1] })).code, 409);
});
test("super admin can change a coordinator's faculties and switch them off, and manage departments", async () => {
  const s = setup();
  assert.equal((await s.call("boss", { action: "coord_update", id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", faculty_ids: [F1, F2], active: false })).code, 200);
  assert.deepEqual(s.db.t.academic_coordinators[0].faculty_ids, [F1, F2]); assert.equal(s.db.t.academic_coordinators[0].active, false);
  assert.equal((await s.call("boss", { action: "dept_add", faculty_id: F1, name: "Mining Engineering" })).code, 200);
  assert.equal(s.db.t.departments.length, 3);
  assert.equal((await s.call("eng", { action: "dept_add", faculty_id: F1, name: "X" })).code, 403);
});

test("only a super administrator can reset a password; the new one is shown once and never stored", async () => {
  const s = setup();
  assert.equal((await s.call("eng", { action: "reset_password", email: "eng@x.com" })).code, 403);
  assert.equal((await s.call("nobody", { action: "reset_password", email: "eng@x.com" })).code, 403);
  const r = await s.call("boss", { action: "reset_password", email: "ENG@x.com" });
  assert.equal(r.code, 200); assert.match(r.body.temp_password, /^[A-Z2-9]{4}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(s.resets.length, 1); assert.equal(s.resets[0].password, r.body.temp_password);
  assert.equal(JSON.stringify(s.db.t).includes(r.body.temp_password), false);
  assert.ok(s.db.t.admin_audit_logs.some((l) => l.action === "academic.reset_password"));
  assert.equal((await s.call("boss", { action: "reset_password", email: "ghost@x.com" })).code, 404);
  assert.equal((await s.call("boss", { action: "reset_password", email: "bad" })).code, 400);
});
