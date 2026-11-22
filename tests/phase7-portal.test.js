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

test("members cannot change anything: every save-style request is refused and nothing is written", async () => {
  const s = setup();
  const before = JSON.stringify(s.db.t.members);
  for (const body of [
    { action: "save", bio: "new bio", phone: "08039999999" },
    { action: "update", course: "Hacked" },
    { action: "delete" },
    { action: "me", id: mem(2).id, email: "m2@x.com", course: "Hacked", review_status: "approved" },
  ]) await s.call("tok1", body);
  assert.equal(JSON.stringify(s.db.t.members), before, "no member record was changed");
  assert.equal((await s.call("tok1", { action: "save", bio: "x" })).code, 400);
  const writes = s.db.calls.filter((c) => c.url.includes("/rest/v1/members") && c.method !== "GET");
  assert.equal(writes.length, 0, "the portal never writes to the members table");
});

test("a rejected registration is not reachable through the portal", async () => {
  const s = setup({ members: [mem(1, { review_status: "rejected" })] });
  assert.equal((await s.call("tok1", { action: "me" })).code, 404);
});
