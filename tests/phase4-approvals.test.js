const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

// The campaigns endpoint is exercised through the real router, with a fake database and a fake sign-in.
function setup(role = "super_admin", env = PROVIDERS) {
  const api = load(env);
  const db = create({ campaigns: [], message_approvals: [], admin_audit_logs: [] });
  const { calls } = db.install();
  const inner = global.fetch;
  const state = { role };
  global.fetch = async (url, opt = {}) => {
    if (url.includes("/auth/v1/user")) return { ok: state.signedIn !== false, status: 200, json: async () => ({ id: "user-" + state.role, email: state.role + "@dcf.test" }) };
    if (url.includes("/rest/v1/admins")) return { ok: true, status: 200, json: async () => (state.role ? [{ role: state.role }] : []) };
    return inner(url, opt);
  };
  const router = api("comms/[action].js");
  const call = async (body, headers = { authorization: "Bearer good" }) => {
    const r = res();
    await router({ method: "POST", query: { action: "campaigns" }, headers, body }, r);
    return r;
  };
  return { db, calls, state, call };
}

const good = (o = {}) => ({
  action: "save", title: "Annual Retreat", channels: ["sms", "email"],
  content: { sms: "Join us for the retreat.", email_subject: "Retreat", email_body: "All are welcome." },
  audience: { all_members: true }, ...o,
});
const future = () => new Date(Date.now() + 3 * 864e5).toISOString();

// ---------- who may do what
test("sign-in is required, and non-admins are refused", async () => {
  const s = setup();
  assert.equal((await s.call(good(), {})).code, 401);
  s.state.role = null;
  assert.equal((await s.call(good())).code, 403);
});

test("moderators can read but never change anything", async () => {
  const s = setup("moderator");
  assert.equal((await s.call({ action: "list" })).code, 200);
  for (const a of ["save", "submit", "cancel", "approve", "reject"]) assert.equal((await s.call(good({ action: a }))).code, 403, a);
  assert.equal(s.db.t.campaigns.length, 0);
});

test("content admins write and submit, but cannot approve or reject", async () => {
  const s = setup("content_admin");
  const saved = await s.call(good());
  assert.equal(saved.code, 200);
  const c = saved.body.campaign;
  assert.equal((await s.call({ action: "submit", id: c.id })).code, 200);
  const pending = s.db.t.campaigns[0];
  assert.equal(pending.status, "pending_approval");
  assert.equal((await s.call({ action: "approve", id: c.id, updated_at: pending.updated_at })).code, 403);
  assert.equal((await s.call({ action: "reject", id: c.id, updated_at: pending.updated_at, note: "no" })).code, 403);
  assert.equal(s.db.t.campaigns[0].status, "pending_approval");
});

test("a role sent by the browser is ignored", async () => {
  const s = setup("content_admin");
  const r = await s.call({ ...good(), role: "super_admin" });
  assert.equal(r.code, 200);
  const id = r.body.campaign.id;
  await s.call({ action: "submit", id });
  assert.equal((await s.call({ action: "approve", id, role: "super_admin", updated_at: s.db.t.campaigns[0].updated_at })).code, 403);
});

// ---------- the happy path
test("draft -> submit -> approve, with a full trail and nothing sent", async () => {
  const s = setup("super_admin");
  const id = (await s.call(good())).body.campaign.id;
  assert.equal(s.db.t.campaigns[0].status, "draft");
  assert.equal(s.db.t.campaigns[0].created_by, "user-super_admin");
  assert.equal((await s.call({ action: "submit", id, note: "Ready" })).code, 200);
  const r = await s.call({ action: "approve", id, note: "Looks good", updated_at: s.db.t.campaigns[0].updated_at });
  assert.equal(r.code, 200);
  assert.equal(r.body.campaign.status, "approved");
  assert.equal(r.body.campaign.approved_by, "user-super_admin");
  assert.deepEqual(s.db.t.message_approvals.map((a) => a.action), ["edited", "submitted", "approved"]);
  assert.ok(s.db.t.admin_audit_logs.some((a) => a.action === "campaign.approved" && a.admin_email === "super_admin@dcf.test"));
  assert.equal(s.db.t.message_queue, undefined, "nothing is queued in Phase 4");
  assert.equal(s.calls.filter((c) => /termii|graph\.facebook/.test(c.url)).length, 0, "no provider is ever called");
});

test("an approved message with a future send time becomes 'scheduled'", async () => {
  const s = setup();
  const id = (await s.call(good({ scheduled_for: future() }))).body.campaign.id;
  await s.call({ action: "submit", id });
  const r = await s.call({ action: "approve", id, updated_at: s.db.t.campaigns[0].updated_at });
  assert.equal(r.body.campaign.status, "scheduled");
});

// ---------- the safety rules
test("approval covers exactly what the approver saw: an edit after viewing blocks it", async () => {
  const s = setup();
  const id = (await s.call(good())).body.campaign.id;
  await s.call({ action: "submit", id });
  const seen = s.db.t.campaigns[0].updated_at;
  s.db.t.campaigns[0].updated_at = "2026-01-01T00:00:00.000Z";           // someone changed it after the approver loaded it
  const r = await s.call({ action: "approve", id, updated_at: seen });
  assert.equal(r.code, 409);
  assert.equal(s.db.t.campaigns[0].status, "pending_approval");
});

test("approve and reject need the version the approver saw", async () => {
  const s = setup();
  const id = (await s.call(good())).body.campaign.id;
  await s.call({ action: "submit", id });
  assert.equal((await s.call({ action: "approve", id })).code, 400);
  assert.equal((await s.call({ action: "reject", id, note: "x" })).code, 400);
});

test("editing a pending message sends it back to draft and clears the approval", async () => {
  const s = setup();
  const id = (await s.call(good())).body.campaign.id;
  await s.call({ action: "submit", id });
  const r = await s.call(good({ id, content: { sms: "New wording", email_subject: "S", email_body: "B" } }));
  assert.equal(r.code, 200);
  assert.equal(s.db.t.campaigns[0].status, "draft");
  assert.equal(s.db.t.campaigns[0].approved_by, null);
  const edit = s.db.t.message_approvals.filter((a) => a.action === "edited").pop();
  assert.match(edit.body_before, /Join us/);
  assert.match(edit.body_after, /New wording/);
});

test("an approved message can no longer be edited, only cancelled", async () => {
  const s = setup();
  const id = (await s.call(good())).body.campaign.id;
  await s.call({ action: "submit", id });
  await s.call({ action: "approve", id, updated_at: s.db.t.campaigns[0].updated_at });
  assert.equal((await s.call(good({ id, title: "Sneaky change" }))).code, 409);
  assert.equal(s.db.t.campaigns[0].title, "Annual Retreat");
  assert.equal((await s.call({ action: "cancel", id })).code, 200);
  assert.equal(s.db.t.campaigns[0].status, "cancelled");
});

test("a message that is not pending cannot be approved, and approving twice does nothing", async () => {
  const s = setup();
  const id = (await s.call(good())).body.campaign.id;
  assert.equal((await s.call({ action: "approve", id, updated_at: s.db.t.campaigns[0].updated_at })).code, 409);   // still a draft
  await s.call({ action: "submit", id });
  const v = s.db.t.campaigns[0].updated_at;
  assert.equal((await s.call({ action: "approve", id, updated_at: v })).code, 200);
  assert.equal((await s.call({ action: "approve", id, updated_at: v })).code, 409);
  assert.equal(s.db.t.message_approvals.filter((a) => a.action === "approved").length, 1);
});

test("rejecting needs a reason, and a rejected message can be fixed and resubmitted", async () => {
  const s = setup();
  const id = (await s.call(good())).body.campaign.id;
  await s.call({ action: "submit", id });
  const v = s.db.t.campaigns[0].updated_at;
  assert.equal((await s.call({ action: "reject", id, updated_at: v })).code, 400);
  assert.equal((await s.call({ action: "reject", id, updated_at: v, note: "Wrong venue" })).code, 200);
  assert.equal(s.db.t.campaigns[0].status, "rejected");
  assert.equal(s.db.t.message_approvals.pop().note, "Wrong venue");
  assert.equal((await s.call({ action: "submit", id })).code, 200);
  assert.equal(s.db.t.campaigns[0].status, "pending_approval");
});

// ---------- validation
test("incomplete messages cannot be submitted or approved", async () => {
  const s = setup();
  assert.equal((await s.call(good({ title: " " }))).code, 400);
  const id = (await s.call(good({ channels: ["whatsapp"], content: {} }))).body.campaign.id;
  const r = await s.call({ action: "submit", id });
  assert.equal(r.code, 400);
  assert.match(r.body.error, /WhatsApp text/);
  const id2 = (await s.call(good({ audience: {} }))).body.campaign.id;
  assert.match((await s.call({ action: "submit", id: id2 })).body.error, /audience/);
  assert.ok(s.db.t.campaigns.every((c) => c.status === "draft"));
});

test("a draft whose send time has already passed cannot be approved", async () => {
  const s = setup();
  const id = (await s.call(good({ scheduled_for: future() }))).body.campaign.id;
  await s.call({ action: "submit", id });
  s.db.t.campaigns[0].scheduled_for = new Date(Date.now() - 36e5).toISOString();
  s.db.t.campaigns[0].updated_at = "2026-02-02T00:00:00.000Z";
  assert.match((await s.call({ action: "approve", id, updated_at: "2026-02-02T00:00:00.000Z" })).body.error, /future/);
});

test("input is cleaned: unknown channels dropped, text capped, https links only", async () => {
  const s = setup();
  const r = await s.call(good({ channels: ["sms", "fax", "sms"], content: { sms: "x".repeat(900), email_subject: "ignored" }, audience: { all_members: false, levels: ["100", "100", ""], departments: ["Law"] }, title: "T".repeat(500) }));
  const c = r.body.campaign;
  assert.deepEqual(c.channels, ["sms"]);
  assert.equal(c.content.sms.length, 320);
  assert.equal(c.content.email_subject, undefined);
  assert.deepEqual(c.audience.levels, ["100"]);
  assert.equal(c.title.length, 120);
  assert.equal((await s.call(good({ registration_url: "javascript:alert(1)" }))).code, 400);
  assert.equal((await s.call(good({ registration_url: "https://dcf.test/retreat" }))).code, 200);
  assert.equal((await s.call(good({ scheduled_for: "not a date" }))).code, 400);
});

test("ids must be real UUIDs and unknown actions are refused", async () => {
  const s = setup();
  assert.equal((await s.call({ action: "get", id: "1; drop table campaigns" })).code, 400);
  assert.equal((await s.call({ action: "get", id: "11111111-1111-1111-1111-111111111111" })).code, 404);
  assert.equal((await s.call({ action: "send_now" })).code, 400);
  assert.equal((await s.call({ action: "constructor" })).code, 400);
});

test("get returns the message with its approval history", async () => {
  const s = setup();
  const id = (await s.call(good())).body.campaign.id;
  await s.call({ action: "submit", id });
  const r = await s.call({ action: "get", id });
  assert.equal(r.body.campaign.id, id);
  assert.deepEqual(r.body.approvals.map((a) => a.action), ["edited", "submitted"]);
});

test("fails closed when the server key is missing", async () => {
  const { SUPABASE_SERVICE_ROLE_KEY, ...noKey } = PROVIDERS;
  const s = setup("super_admin", noKey);
  const r = await s.call(good());
  assert.equal(r.code, 503);
  assert.equal(s.db.t.campaigns.length, 0);
});

// ---------- server key naming
test("the newer SUPABASE_SECRET_KEY name works, and sb_secret_ keys are sent as apikey only", async () => {
  const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = PROVIDERS;
  const api = load({ ...rest, SUPABASE_SECRET_KEY: "sb_secret_abc" });
  const seen = [];
  global.fetch = async (url, opt = {}) => { seen.push(opt.headers); return { ok: true, status: 200, json: async () => [] }; };
  const { srv, hasSrv } = api("_comms/db.js");
  assert.equal(hasSrv(), true);
  await srv("campaigns?select=id");
  assert.equal(seen[0].apikey, "sb_secret_abc");
  assert.equal(seen[0].Authorization, undefined);
  const jwt = load({ ...rest, SUPABASE_SECRET_KEY: "eyJhbGciOi.jwt.like" })("_comms/db.js");
  await jwt.srv("campaigns?select=id");
  assert.equal(seen[1].Authorization, "Bearer eyJhbGciOi.jwt.like");
});
