const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

const SB = "https://takdaiqvaxancqrqwwhy.supabase.co";
const PHOTO = SB + "/storage/v1/object/public/member-photos/";
const mem = (n, o = {}) => ({ id: `00000000-0000-0000-0000-00000000000${n}`, full_name: `Member ${n}`, email: `m${n}@x.com`, phone: "08031234567", department: "Choir", faculty: "Arts", course: "History", level: "300",
  bio: "old bio", skills_business: "old skill", photo_url: PHOTO + "a.jpg", review_status: "approved", profile_approved: true, consent_public: true, created_at: "2026-01-01T00:00:00Z", ...o });

// A world where tokens map to users: "tok1" is m1@x.com (confirmed), "tokU" is unconfirmed, "bad" is invalid.
function setup({ members = [mem(1), mem(2)], attendance = [], sessions = [] } = {}) {
  const api = load({ ...PROVIDERS });
  const db = create({ members, attendance, sessions });
  db.install({});
  const inner = global.fetch;
  const users = { tok1: { email: "M1@x.com", email_confirmed_at: "2026-01-01" }, tokU: { email: "m1@x.com", email_confirmed_at: null }, tokNone: { email: "nobody@x.com", email_confirmed_at: "2026-01-01" }, tok2: { email: "m2@x.com", email_confirmed_at: "2026-01-01" } };
  global.fetch = async (url, opt = {}) => {
    if (url.includes("/auth/v1/user")) {
      const t = String((opt.headers || {}).Authorization || "").replace("Bearer ", ""), u = users[t];
      return u ? { ok: true, status: 200, json: async () => u } : { ok: false, status: 401, json: async () => ({}) };
    }
    return inner(url, opt);
  };
  const router = api("comms/[action].js");
  const call = async (token, body) => { const r = res(); await router({ method: "POST", query: { action: "portal" }, headers: token ? { authorization: "Bearer " + token } : {}, body }, r); return r; };
  return { db, call };
}

test("you must be signed in, with a confirmed email", async () => {
  const s = setup();
  assert.equal((await s.call(null, { action: "me" })).code, 401);
  assert.equal((await s.call("bad", { action: "me" })).code, 401);
  const u = await s.call("tokU", { action: "me" });
  assert.equal(u.code, 403);
  assert.match(u.body.error, /confirm your email/i);
});

test("a signed-in email with no registration gets a clear message, and no one else's data", async () => {
  const r = await setup().call("tokNone", { action: "me" });
  assert.equal(r.code, 404);
  assert.match(r.body.error, /register/i);
  assert.equal(JSON.stringify(r.body).includes("Member"), false);
});

test("a member sees only their own record and attendance", async () => {
  const s = setup({ sessions: [{ id: "s1", kind: "Celebration Service", session_date: "2026-11-15" }, { id: "s2", kind: "Bible Study", session_date: "2026-11-12" }],
    attendance: [{ id: "a1", session_id: "s1", member_id: mem(1).id, created_at: "2026-11-15T10:00:00Z" }, { id: "a2", session_id: "s2", member_id: mem(2).id, created_at: "2026-11-12T10:00:00Z" }] });
  const r = await s.call("tok1", { action: "me" });
  assert.equal(r.code, 200);
  assert.equal(r.body.member.full_name, "Member 1");
  assert.equal(r.body.attendance.attended, 1);
  assert.deepEqual(r.body.attendance.recent, [{ kind: "Celebration Service", date: "2026-11-15" }]);
});

test("the browser cannot choose which record to change", async () => {
  const s = setup();
  await s.call("tok1", { action: "save", id: mem(2).id, member_id: mem(2).id, email: "m2@x.com", course: "Hacked" });
  assert.equal(s.db.t.members.find((m) => m.id === mem(2).id).course, "History");
  assert.equal(s.db.t.members.find((m) => m.id === mem(1).id).course, "Hacked", "only the signed-in member's own record changes");
});

test("leader-controlled fields cannot be changed by a member", async () => {
  const s = setup({ members: [mem(1, { review_status: "pending", profile_approved: false })] });
  const r = await s.call("tok1", { action: "save", phone: "08039999999", review_status: "approved", profile_approved: true, department: "Media", full_name: "Boss", email: "x@x.com", consent_comms: true });
  assert.equal(r.code, 200);
  const m = s.db.t.members[0];
  assert.equal(m.phone, "08039999999");
  assert.deepEqual([m.review_status, m.profile_approved, m.department, m.full_name, m.email], ["pending", false, "Choir", "Member 1", "m1@x.com"]);
});

test("changing bio, skills or photo hides the public profile until a leader approves again", async () => {
  const s = setup();
  const r = await s.call("tok1", { action: "save", bio: "new bio" });
  assert.equal(r.body.reapproval, true);
  assert.equal(s.db.t.members[0].profile_approved, false);
  assert.match(r.body.message, /approves your changes/);
});

test("changing private details does not hide the public profile", async () => {
  const s = setup();
  await s.call("tok1", { action: "save", phone: "08031112222", hostel_address: "Block C" });
  assert.equal(s.db.t.members[0].profile_approved, true);
});

test("turning the public profile off hides it at once", async () => {
  const s = setup();
  const r = await s.call("tok1", { action: "save", consent_public: false });
  assert.equal(s.db.t.members[0].profile_approved, false);
  assert.equal(r.body.reapproval, false);
});

test("bad input is refused: phone, level, foreign photo link, empty save", async () => {
  const s = setup();
  assert.equal((await s.call("tok1", { action: "save", phone: "123" })).code, 400);
  assert.equal((await s.call("tok1", { action: "save", level: "999" })).code, 400);
  assert.equal((await s.call("tok1", { action: "save", photo_url: "https://evil.example/x.jpg" })).code, 400);
  assert.equal((await s.call("tok1", { action: "save" })).code, 400);
  assert.equal((await s.call("tok1", { action: "delete" })).code, 400);
  assert.equal(s.db.t.members[0].phone, "08031234567");
});

test("a rejected registration is not reachable through the portal", async () => {
  const s = setup({ members: [mem(1, { review_status: "rejected" })] });
  assert.equal((await s.call("tok1", { action: "me" })).code, 404);
});
