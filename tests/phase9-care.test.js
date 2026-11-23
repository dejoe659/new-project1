const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

const USERS = { counsellor: { email: "c@x.com", role: "content_admin" }, prayer: { email: "p@x.com", role: "moderator" }, boss: { email: "boss@x.com", role: "super_admin" }, plain: { email: "n@x.com", role: "content_admin" }, stranger: { email: "s@x.com", role: null } };
const uid = (t) => `00000000-0000-0000-0000-00000000000${Object.keys(USERS).indexOf(t) + 1}`;

function setup(seed = {}) {
  const api = load({ ...PROVIDERS });
  const db = create({ care_requests: [], care_team: [{ id: "t1", email: "c@x.com", role: "counsellor" }, { id: "t2", email: "p@x.com", role: "prayer" }], admin_audit_logs: [], ...seed });
  db.install({});
  const inner = global.fetch;
  global.fetch = async (url, opt = {}) => {
    const tok = String((opt.headers || {}).Authorization || "").replace("Bearer ", ""), u = USERS[tok];
    if (url.includes("/auth/v1/user")) return u ? { ok: true, status: 200, json: async () => ({ id: uid(tok), email: u.email }) } : { ok: false, status: 401, json: async () => ({}) };
    if (url.includes("/rest/v1/admins")) return { ok: true, status: 200, json: async () => (u && u.role ? [{ role: u.role }] : []) };
    return inner(url, opt);
  };
  const router = api("comms/[action].js");
  let ip = 0;
  const call = async (token, body, ipAddr) => { const r = res(); await router({ method: "POST", query: { action: "care" }, headers: { ...(token ? { authorization: "Bearer " + token } : {}), "x-forwarded-for": ipAddr || "9.9.9." + ++ip }, body }, r); return r; };
  return { db, call };
}
const prayer = (o = {}) => ({ action: "submit", kind: "prayer", category: "Health", message: "Please pray for my exams.", name: "Ada Obi", phone: "08031234567", ...o });
const counselling = (o = {}) => ({ action: "submit", kind: "counselling", category: "Family", message: "I need someone to talk to.", name: "Bayo", phone: "08031234567", ...o });

test("submitting gives a one-time code; only a hash of it is stored; the status page reveals nothing private", async () => {
  const s = setup();
  const r = await s.call(null, prayer());
  assert.equal(r.code, 200);
  assert.match(r.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const row = s.db.t.care_requests[0];
  assert.equal(JSON.stringify(row).includes(r.body.code.replace(/-/g, "")), false, "the code itself is not stored");
  const st = await s.call(null, { action: "status", code: r.body.code.toLowerCase() });
  assert.equal(st.code, 200);
  assert.equal(st.body.status, "Received");
  assert.equal(JSON.stringify(st.body).includes("exams"), false);
  assert.equal(JSON.stringify(st.body).includes("Ada"), false);
});

test("a wrong or malformed code finds nothing", async () => {
  const s = setup(); await s.call(null, prayer());
  assert.equal((await s.call(null, { action: "status", code: "AAAA-BBBB-CCCC" })).code, 404);
  assert.equal((await s.call(null, { action: "status", code: "short" })).code, 400);
});

test("counselling is always counsellors-only; it needs a way to reach the person unless anonymous", async () => {
  const s = setup();
  assert.equal((await s.call(null, counselling({ phone: "", email: "" }))).code, 400);
  assert.equal((await s.call(null, counselling({ privacy: "prayer_team" }))).code, 200);
  assert.equal(s.db.t.care_requests[0].privacy, "counsellors_only");
  const a = await s.call(null, counselling({ anonymous: true, name: "Secret", phone: "", email: "" }));
  assert.equal(a.code, 200);
  const row = s.db.t.care_requests[1];
  assert.deepEqual([row.name, row.phone, row.email, row.anonymous], [null, null, null, true], "anonymous means nothing identifying is stored");
});

test("bad input, honeypot and flooding are refused", async () => {
  const s = setup();
  assert.equal((await s.call(null, prayer({ message: "hi" }))).code, 400);
  assert.equal((await s.call(null, prayer({ kind: "other" }))).code, 400);
  assert.equal((await s.call(null, prayer({ phone: "12" }))).code, 400);
  assert.equal((await s.call(null, prayer({ email: "nope" }))).code, 400);
  assert.equal((await s.call(null, prayer({ website: "spam" }))).code, 200);
  assert.equal(s.db.t.care_requests.length, 0);
  for (let i = 0; i < 5; i++) assert.equal((await s.call(null, prayer(), "1.2.3.4")).code, 200);
  assert.equal((await s.call(null, prayer(), "1.2.3.4")).code, 429, "sixth request in an hour from one address");
  assert.equal((await s.call(null, prayer(), "5.6.7.8")).code, 200, "another address is unaffected");
});

test("only signed-in administrators on the care team can see anything, super administrators included", async () => {
  const s = setup(); await s.call(null, prayer());
  assert.equal((await s.call(null, { action: "list" })).code, 401);
  assert.equal((await s.call("stranger", { action: "list" })).code, 403);
  const plain = await s.call("plain", { action: "list" });
  assert.equal(plain.code, 403);
  assert.match(plain.body.error, /care team/);
  assert.equal((await s.call("boss", { action: "list" })).code, 403, "a super administrator is not automatically on the care team");
  assert.equal((await s.call("boss", { action: "get", id: s.db.t.care_requests[0].id })).code, 403);
});

test("the prayer team sees only open prayer requests; counsellors see everything", async () => {
  const s = setup();
  await s.call(null, prayer({ message: "open prayer request" }));
  await s.call(null, prayer({ privacy: "counsellors_only", message: "private prayer request" }));
  await s.call(null, counselling());
  const p = await s.call("prayer", { action: "list" });
  assert.equal(p.body.requests.length, 1);
  assert.equal(p.body.requests[0].kind, "prayer");
  const c = await s.call("counsellor", { action: "list" });
  assert.equal(c.body.requests.length, 3);
  const hidden = s.db.t.care_requests.filter((r) => r.privacy === "counsellors_only");
  for (const h of hidden) assert.equal((await s.call("prayer", { action: "get", id: h.id })).code, 404, "not even their existence is confirmed");
});

test("the list never contains the request text or contact details", async () => {
  const s = setup(); await s.call(null, prayer());
  const c = await s.call("counsellor", { action: "list" });
  const text = JSON.stringify(c.body);
  for (const secret of ["exams", "08031234567", "Please pray"]) assert.equal(text.includes(secret), false, secret);
  assert.equal(c.body.requests[0].who, "Ada Obi");
});

test("opening a request is audited (without its content); updating changes status and note", async () => {
  const s = setup(); await s.call(null, prayer());
  const id = s.db.t.care_requests[0].id;
  const g = await s.call("counsellor", { action: "get", id });
  assert.equal(g.code, 200);
  assert.match(g.body.request.message, /exams/);
  const logs = s.db.t.admin_audit_logs;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "care.view");
  assert.equal(logs[0].admin_email, "c@x.com");
  assert.equal(JSON.stringify(logs[0]).includes("exams"), false, "the audit log never holds the content");
  const u = await s.call("prayer", { action: "update", id, status: "prayed", team_note: "Prayed on Sunday" });
  assert.equal(u.code, 200);
  assert.deepEqual([s.db.t.care_requests[0].status, s.db.t.care_requests[0].team_note, s.db.t.care_requests[0].handled_by], ["prayed", "Prayed on Sunday", "p@x.com"]);
  assert.equal(logs.length, 2);
  assert.equal((await s.call("counsellor", { action: "update", id, status: "bogus" })).code, 400);
  const st = await s.call(null, { action: "status", code: "AAAAAAAAAAAA" });
  assert.equal(st.code, 404);
});

test("the person sees the new status but never the team's notes", async () => {
  const s = setup(); const r = await s.call(null, prayer());
  await s.call("counsellor", { action: "update", id: s.db.t.care_requests[0].id, status: "follow_up", team_note: "internal remark" });
  const st = await s.call(null, { action: "status", code: r.body.code });
  assert.match(st.body.status, /follow up/);
  assert.equal(JSON.stringify(st.body).includes("internal remark"), false);
});

test("only a counsellor can delete, and only after closing", async () => {
  const s = setup(); await s.call(null, prayer());
  const id = s.db.t.care_requests[0].id;
  assert.equal((await s.call("counsellor", { action: "delete", id })).code, 409, "not closed yet");
  await s.call("counsellor", { action: "update", id, status: "closed" });
  assert.equal((await s.call("prayer", { action: "delete", id })).code, 403);
  assert.equal(s.db.t.care_requests.length, 1);
  assert.equal((await s.call("counsellor", { action: "delete", id })).code, 200);
  assert.equal(s.db.t.care_requests.length, 0);
  assert.ok(s.db.t.admin_audit_logs.some((l) => l.action === "care.delete"));
});

test("only a super administrator manages the care team, and it is audited", async () => {
  const s = setup();
  assert.equal((await s.call("counsellor", { action: "team_add", email: "z@x.com", role: "prayer" })).code, 403);
  assert.equal((await s.call("counsellor", { action: "team" })).code, 403);
  assert.equal((await s.call("boss", { action: "team_add", email: "Z@x.com", role: "prayer" })).code, 200);
  assert.equal((await s.call("boss", { action: "team_add", email: "z@x.com", role: "counsellor" })).code, 409);
  assert.equal((await s.call("boss", { action: "team_add", email: "bad", role: "prayer" })).code, 400);
  assert.equal((await s.call("boss", { action: "team_add", email: "q@x.com", role: "king" })).code, 400);
  const t = await s.call("boss", { action: "team" });
  assert.equal(t.body.team.length, 3);
  assert.equal((await s.call("boss", { action: "team_remove", id: "t2" })).code, 400, "needs a real id");
  const z = s.db.t.care_team.find((x) => x.email === "z@x.com");
  s.db.t.care_team.find((x) => x.email === "z@x.com").id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  assert.equal((await s.call("boss", { action: "team_remove", id: "cccccccc-cccc-cccc-cccc-cccccccccccc" })).code, 200);
  assert.equal(s.db.t.care_team.some((x) => x.email === "z@x.com"), false);
  assert.ok(s.db.t.admin_audit_logs.filter((l) => l.action.startsWith("care.team")).length >= 2);
  void z;
});

test("access tells the page who may see what", async () => {
  const s = setup();
  assert.deepEqual((await s.call("counsellor", { action: "access" })).body, { role: "counsellor", super_admin: false });
  assert.deepEqual((await s.call("boss", { action: "access" })).body, { role: null, super_admin: true });
});
