const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

const ENV = { ...PROVIDERS, GMAIL_USER: "dcf@gmail.com", GMAIL_APP_PASSWORD: "x", UNSUBSCRIBE_SECRET: "u", SITE_URL: "https://dcf.test", CRON_SECRET: "cron-secret" };
const id = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const CID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const member = (n, o = {}) => ({ id: id(n), full_name: `Ada${n} Obi`, email: `m${n}@x.com`, phone: `0803333444${n}`, level: "100", department: "Law", review_status: "approved", ...o });
const pref = (n, o = {}) => ({ member_id: id(n), sms_opt_in: true, email_opt_in: true, whatsapp_opt_in: false, opted_out: false, ...o });
const camp = (o = {}) => ({ id: CID, title: "Retreat", status: "approved", channels: ["sms", "email"], audience: { all_members: true }, scheduled_for: null,
  content: { sms: "Hi {name}, retreat on Friday.", email_subject: "Retreat", email_body: "Hi {name}, all welcome." }, updated_at: "2026-11-20T10:00:00.000Z", ...o });
const transport = (fail) => { const sent = []; return { sent, sendMail: async (m) => { if (fail) throw fail; sent.push(m); return { messageId: "<m" + sent.length + ">", accepted: [m.to], rejected: [] }; } }; };

// A live (not test-mode) world with the given members, a fake sign-in and a fake mail transport.
function setup({ members = [member(1), member(2)], prefs = [pref(1), pref(2)], campaigns = [camp()], testMode = { enabled: false, recipients: [] }, sms, role = "super_admin", mail } = {}) {
  const api = load(ENV);
  const db = create({ members, member_preferences: prefs, campaigns, message_approvals: [], admin_audit_logs: [], communication_settings: [{ key: "test_mode", value: testMode }] });
  const { calls, providers } = db.install(sms ? { sms } : {});
  const inner = global.fetch;
  global.fetch = async (url, opt = {}) => {
    if (url.includes("/auth/v1/user")) return { ok: true, status: 200, json: async () => ({ id: "11111111-aaaa-bbbb-cccc-000000000001", email: "boss@dcf.test" }) };
    if (url.includes("/rest/v1/admins")) return { ok: true, status: 200, json: async () => [{ role }] };
    return inner(url, opt);
  };
  const mailer = mail || transport();
  api("_comms/providers/gmail.js")._setTransport(mailer);
  const router = api("comms/[action].js");
  const call = async (body) => { const r = res(); await router({ method: "POST", query: { action: "campaigns" }, headers: { authorization: "Bearer good" }, body }, r); return r; };
  const cron = async (auth = "Bearer cron-secret") => { const r = res(); await router({ method: "GET", query: { action: "queue-run" }, headers: { authorization: auth } }, r); return r; };
  return { db, calls, providers, mailer, call, cron, api };
}
const q = (s) => s.db.t.message_queue || [];

// ---------- expansion: who gets what
test("sending an approved message queues one row per person and channel, and sends them", async () => {
  const s = setup();
  const r = await s.call({ action: "send", id: CID });
  assert.equal(r.code, 200);
  assert.equal(r.body.started.queued, 4);
  assert.equal(r.body.progress.sent, 4);
  assert.equal(r.body.campaign.status, "sent");
  assert.equal(s.providers.sms.length, 2);
  assert.equal(s.mailer.sent.length, 2);
  assert.match(s.providers.sms[0].sms, /Hi Ada1,/, "{name} is filled in per person");
  assert.ok(q(s).every((x) => x.status === "sent" && x.campaign_id === CID && x.category === "announcement"));
  assert.ok(s.db.t.message_log.every((l) => l.queue_id), "every log row points back to its queue row");
  assert.ok(s.db.t.admin_audit_logs.some((a) => a.action === "campaign.send"));
});

test("people without consent, opted out, suppressed, or with bad contacts are left out, with reasons", async () => {
  const members = [member(1), member(2), member(3), member(4), member(5, { phone: "123" }), member(6)];
  const prefs = [pref(1), pref(2, { sms_opt_in: false }), pref(3, { opted_out: true }), pref(4), pref(5), /* 6: no record */];
  const s = setup({ members, prefs });
  s.db.t.contact_suppressions.push({ channel: "email", address: "m4@x.com" });
  const r = await s.call({ action: "send", id: CID });
  const sk = r.body.started.skipped;
  assert.equal(sk["no consent for sms"], 1);
  assert.equal(sk["member opted out"], 2);          // both channels of the opted-out member
  assert.equal(sk["contact opted out"], 1);
  assert.equal(sk["invalid phone number"], 1);
  assert.equal(sk["no consent record"], 2);         // member 6, both channels
  assert.deepEqual(new Set(q(s).map((x) => x.member_id + x.channel)), new Set([id(1) + "sms", id(1) + "email", id(2) + "email", id(4) + "sms", id(5) + "email"]));
});

test("audience: by level or department, case-insensitively, and only approved members", async () => {
  const members = [member(1, { level: "100", department: "Arts" }), member(2, { level: "200", department: "Arts" }), member(3, { level: "300", department: "LAW" }), member(4, { level: "100", department: "Arts", review_status: "pending" })];
  const s = setup({ members, prefs: members.map((m, i) => pref(i + 1)), campaigns: [camp({ channels: ["sms"], audience: { levels: ["100"], departments: ["law"] } })] });
  const r = await s.call({ action: "send", id: CID });
  assert.deepEqual(q(s).map((x) => x.member_id).sort(), [id(1), id(3)]);
  assert.equal(r.body.progress.sent, 2);
});

// ---------- the safety rules
test("test mode: nobody outside the test list is messaged", async () => {
  const s = setup({ testMode: { enabled: true, recipients: ["2348033334441", "m1@x.com"] } });
  const r = await s.call({ action: "send", id: CID });
  assert.equal(r.body.progress.sent, 2);                       // member 1's SMS and email only
  assert.equal(s.providers.sms.length, 1);
  assert.equal(s.mailer.sent.length, 1);
  assert.equal(s.mailer.sent[0].to, "m1@x.com");
  assert.equal(r.body.progress.skipped, 2);
  assert.equal(r.body.progress.reasons["test mode: recipient not authorised"], 2);
});

test("test mode with the placeholder list sends nothing and the campaign ends as failed", async () => {
  const s = setup({ testMode: { enabled: true, recipients: ["2348012345678", "you@gmail.com"] } });
  const r = await s.call({ action: "send", id: CID });
  assert.equal(s.providers.sms.length + s.mailer.sent.length, 0);
  assert.equal(r.body.campaign.status, "failed");
  assert.equal(r.body.progress.sent, 0);
});

test("consent is checked again at send time: someone who opts out after queuing gets nothing", async () => {
  const s = setup();
  await s.api("_comms/queue.js").expandCampaign(camp());
  s.db.t.member_preferences.find((p) => p.member_id === id(1)).opted_out = true;
  await s.api("_comms/queue.js").runBatch({ campaignId: CID });
  assert.equal(s.providers.sms.length, 1);
  assert.equal(s.mailer.sent.length, 1);
  assert.equal(q(s).filter((x) => x.status === "cancelled" && /opted out/.test(x.last_error)).length, 2);
});

test("a message can only be sent once", async () => {
  const s = setup();
  assert.equal((await s.call({ action: "send", id: CID })).code, 200);
  assert.equal((await s.call({ action: "send", id: CID })).code, 409);
  assert.equal(s.providers.sms.length, 2);
  // even if expansion were repeated, unique keys stop duplicate rows
  const queue = s.api("_comms/queue.js");
  s.db.t.campaigns[0].status = "approved";
  await queue.expandCampaign(s.db.t.campaigns[0]);
  assert.equal(q(s).length, 4);
});

test("only a super admin can send; content admins and moderators are refused", async () => {
  for (const role of ["content_admin", "moderator"]) {
    const s = setup({ role });
    for (const a of ["send", "run"]) assert.equal((await s.call({ action: a, id: CID })).code, 403, role + " " + a);
    assert.equal(q(s).length, 0);
    assert.equal(s.providers.sms.length, 0);
  }
});

test("only an approved message can be sent", async () => {
  for (const status of ["draft", "pending_approval", "rejected", "cancelled", "sent"]) {
    const s = setup({ campaigns: [camp({ status })] });
    assert.equal((await s.call({ action: "send", id: CID })).code, 409, status);
    assert.equal(q(s).length, 0);
  }
  const s = setup({ campaigns: [camp({ status: "scheduled", scheduled_for: new Date(Date.now() + 864e5).toISOString() })] });
  assert.match((await s.call({ action: "send", id: CID })).body.error, /scheduled/);
});

// ---------- retries
test("temporary failures are retried later with a wait, and eventually succeed", async () => {
  let n = 0;
  const sms = () => (++n === 1 ? { ok: false, status: 503, json: async () => ({ message: "busy" }) } : { ok: true, status: 200, json: async () => ({ message_id: "T" + n, message: "Successfully Sent" }) });
  const s = setup({ members: [member(1)], prefs: [pref(1)], campaigns: [camp({ channels: ["sms"] })], sms });
  await s.call({ action: "send", id: CID });
  let row = q(s)[0];
  assert.equal(row.status, "scheduled");
  assert.equal(row.attempts, 1);
  assert.ok(new Date(row.next_attempt_at) > new Date(), "waits before trying again");
  assert.equal(s.db.t.campaigns[0].status, "processing", "campaign stays open while a retry is pending");
  row.next_attempt_at = new Date(Date.now() - 1000).toISOString();            // the wait is over
  await s.cron();
  row = q(s)[0];
  assert.equal(row.status, "sent");
  assert.equal(row.attempts, 2);
  assert.equal(s.db.t.campaigns[0].status, "sent");
  assert.deepEqual(s.db.t.message_log.map((l) => [l.status, l.retry_count]), [["failed", 0], ["sent", 1]]);
});

test("permanent failures are not retried and are dead-lettered", async () => {
  const sms = () => ({ ok: false, status: 400, json: async () => ({ message: "Invalid number" }) });
  const s = setup({ members: [member(1)], prefs: [pref(1)], campaigns: [camp({ channels: ["sms"] })], sms });
  const r = await s.call({ action: "send", id: CID });
  const row = q(s)[0];
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 1);
  assert.ok(row.dead_lettered_at);
  assert.match(row.last_error, /Invalid number/);
  assert.equal(r.body.campaign.status, "failed");
});

test("retries stop after the maximum number of attempts", async () => {
  const sms = () => ({ ok: false, status: 500, json: async () => ({ message: "down" }) });
  const s = setup({ members: [member(1)], prefs: [pref(1)], campaigns: [camp({ channels: ["sms"] })], sms });
  await s.call({ action: "send", id: CID });
  for (let i = 0; i < 5; i++) { q(s)[0].next_attempt_at = new Date(Date.now() - 1000).toISOString(); await s.cron(); }
  assert.equal(q(s)[0].attempts, 3);
  assert.equal(q(s)[0].status, "failed");
  assert.equal(s.providers.sms.length, 3, "never more than max_attempts sends");
});

test("a row that was mid-send when the server stopped is never sent again", async () => {
  const s = setup({ members: [member(1)], prefs: [pref(1)], campaigns: [camp({ channels: ["sms"], status: "processing" })] });
  s.db.t.message_queue = [{ id: "r1", idempotency_key: "k", campaign_id: CID, member_id: id(1), channel: "sms", recipient_name: "Member 1", recipient_address: "2348033334441", body: "Hi", status: "processing",
    locked_at: new Date(Date.now() - 3600000).toISOString(), attempts: 1, max_attempts: 3 }];
  await s.cron();
  assert.equal(q(s)[0].status, "failed");
  assert.match(q(s)[0].last_error, /Not retried automatically/);
  assert.equal(s.providers.sms.length, 0);
});

test("two workers cannot send the same row: the second claim finds it taken", async () => {
  const s = setup({ members: [member(1)], prefs: [pref(1)], campaigns: [camp({ channels: ["sms"] })] });
  const queue = s.api("_comms/queue.js");
  await queue.expandCampaign(camp({ channels: ["sms"] }));
  await Promise.all([queue.runBatch({ campaignId: CID, workerId: "a" }), queue.runBatch({ campaignId: CID, workerId: "b" })]);
  assert.equal(s.providers.sms.length, 1);
});

// ---------- batches, the daily job, and the page's progress loop
test("a batch sends at most its limit, and 'run' continues where it stopped", async () => {
  const members = [1, 2, 3, 4, 5].map((n) => member(n)), prefs = members.map((m, i) => pref(i + 1));
  const s = setup({ members, prefs, campaigns: [camp({ channels: ["sms"] })] });
  const queue = s.api("_comms/queue.js");
  await queue.expandCampaign(camp({ channels: ["sms"] }));
  await queue.runBatch({ campaignId: CID, limit: 2 });
  assert.equal(s.providers.sms.length, 2);
  assert.equal(s.db.t.campaigns[0].status, "processing");
  let r = await s.call({ action: "run", id: CID });
  assert.equal(r.body.progress.sent, 5, "run sends the rest within its time budget");
  assert.equal(r.body.progress.waiting, 0);
  assert.equal(s.providers.sms.length, 5);
  assert.equal(r.body.campaign.status, "sent");
});

test("the daily job sends scheduled messages that are due, and leaves future ones alone", async () => {
  const past = new Date(Date.now() - 3600000).toISOString(), future = new Date(Date.now() + 864e5).toISOString();
  const s = setup({ members: [member(1)], prefs: [pref(1)], campaigns: [camp({ status: "scheduled", scheduled_for: past, channels: ["sms"] }), camp({ id: "dddddddd-dddd-dddd-dddd-dddddddddddd", status: "scheduled", scheduled_for: future, channels: ["sms"] })] });
  const r = await s.cron();
  assert.equal(r.code, 200);
  assert.equal(r.body.started.length, 1);
  assert.equal(s.providers.sms.length, 1);
  assert.equal(s.db.t.campaigns.find((c) => c.id === CID).status, "sent");
  assert.equal(s.db.t.campaigns.find((c) => c.id.startsWith("dddd")).status, "scheduled");
});

test("the daily job refuses callers without the secret", async () => {
  const s = setup();
  assert.equal((await s.cron("")).code, 401);
  assert.equal((await s.cron("Bearer wrong")).code, 401);
  assert.equal(s.providers.sms.length, 0);
});

test("a cancelled campaign's waiting rows are not sent", async () => {
  const s = setup({ members: [member(1)], prefs: [pref(1)], campaigns: [camp({ channels: ["sms"], status: "scheduled", scheduled_for: new Date(Date.now() + 864e5).toISOString() })] });
  assert.equal((await s.call({ action: "cancel", id: CID })).code, 200);
  await s.cron();
  assert.equal(s.providers.sms.length, 0);
  assert.equal(s.db.t.campaigns[0].status, "cancelled");
});

test("get shows progress once sending has started", async () => {
  const s = setup();
  await s.call({ action: "send", id: CID });
  const r = await s.call({ action: "get", id: CID });
  assert.equal(r.body.progress.sent, 4);
  assert.equal((await s.call({ action: "progress", id: CID })).body.progress.total, 4);
});
