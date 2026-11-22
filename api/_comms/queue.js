// Phase 5: turns an approved campaign into one queue row per person and channel, then sends the rows in small batches.
// Every row goes through the same safe path as all other messages (consent, opt-out list, test mode), checked again at send time.
//
// Safety rules in this file:
//  - A campaign is expanded exactly once (it is claimed by changing its status), and every row has a unique key,
//    so running anything twice can never create a second copy of a message.
//  - A row is claimed before it is sent. If the server stops in the middle of a send, the row is NOT sent again
//    (we cannot know whether it went out). It is marked failed and left for a person to check.
//  - Only temporary failures (network, rate limit, provider 5xx) are retried, with growing waits. Anything else is final.
const { srv } = require("./db");
const { sendAll } = require("../_notify");
const { normalize } = require("./phone");

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PROVIDER = { email: "gmail", sms: "termii", whatsapp: "whatsapp_cloud" };
const BACKOFF_MIN = [5, 30, 120, 480];                     // wait before retry 1, 2, 3, ...
const STALE_MS = 10 * 60 * 1000;
const CONCURRENCY = 5;
const emailDailyLimit = () => Math.max(1, Number(process.env.EMAIL_DAILY_LIMIT) || 400);   // Gmail's own limit is about 500 a day
const enc = encodeURIComponent;
const lower = (v) => String(v || "").trim().toLowerCase();
const rep = { headers: { Prefer: "return=representation" }, json: true };

// Who a campaign is for. Returns members matching the audience (consent is applied separately, per channel).
function inAudience(a, m) {
  if (!a) return false;
  if (a.all_members === true) return true;
  const levels = (a.levels || []).map(lower), deps = (a.departments || []).map(lower);
  return (levels.length && levels.includes(lower(m.level))) || (deps.length && deps.includes(lower(m.department)));
}

// Can this member be messaged on this channel? Returns { address } or { why }. Used for campaigns and for automatic follow-ups.
//   p = the member's saved preferences (or undefined), blocked = Set of "channel|address" opt-outs.
function reach(m, ch, p, blocked) {
  if (!p) return { why: "no consent record" };
  if (p.opted_out) return { why: "member opted out" };
  if (!p[ch + "_opt_in"]) return { why: "no consent for " + ch };
  let address;
  if (ch === "email") { address = lower(m.email); if (!EMAIL_RE.test(address)) return { why: "invalid email address" }; }
  else { const n = normalize(m.phone); if (!n.ok) return { why: "invalid phone number" }; address = n.digits; }
  if (blocked.has(`${ch}|${address}`) || blocked.has(`all|${address}`)) return { why: "contact opted out" };
  return { address };
}
const loadContext = async () => {
  const [prefs, sup] = await Promise.all([
    srv("member_preferences?select=member_id,whatsapp_opt_in,sms_opt_in,email_opt_in,opted_out&limit=5000"),
    srv("contact_suppressions?select=channel,address&limit=20000"),
  ]);
  return { pref: Object.fromEntries(prefs.map((p) => [p.member_id, p])), blocked: new Set(sup.map((x) => `${x.channel}|${x.address}`)) };
};

// Claims the campaign (approved/scheduled -> processing) and creates its queue rows. Safe to call twice: the second call does nothing.
async function expandCampaign(campaign) {
  const claimed = await srv(`campaigns?id=eq.${campaign.id}&status=in.(approved,scheduled)`, { method: "PATCH", body: JSON.stringify({ status: "processing" }), ...rep });
  if (!claimed.length) return { started: false, reason: "already started" };
  const c = claimed[0];
  try {
    const [members, { pref, blocked }] = await Promise.all([
      srv("members?review_status=eq.approved&select=id,full_name,email,phone,level,department&limit=5000"),
      loadContext(),
    ]);
    const rows = [], skipped = {};
    const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
    for (const m of members.filter((x) => inAudience(c.audience, x))) {
      for (const ch of c.channels || []) {
        const wording = ch === "email" ? c.content.email_body : c.content[ch];
        if (!wording) { skip("no wording for " + ch); continue; }
        const r = reach(m, ch, pref[m.id], blocked);
        if (r.why) { skip(r.why); continue; }
        rows.push({ idempotency_key: `campaign:${c.id}:${m.id}:${ch}`, category: "announcement", mode: "manual", channel: ch, provider: PROVIDER[ch],
          member_id: m.id, campaign_id: c.id, recipient_name: m.full_name, recipient_address: r.address,
          subject: ch === "email" ? c.content.email_subject : null, body: wording, status: "approved" });
      }
    }
    for (let i = 0; i < rows.length; i += 200)
      await srv("message_queue?on_conflict=idempotency_key", { method: "POST", body: JSON.stringify(rows.slice(i, i + 200)), headers: { Prefer: "resolution=ignore-duplicates,return=minimal" } });
    if (!rows.length) await finish(c.id);
    return { started: true, queued: rows.length, skipped };
  } catch (e) {
    // Put the campaign back so it can be retried; the unique keys make a second attempt safe.
    await srv(`campaigns?id=eq.${c.id}&status=eq.processing`, { method: "PATCH", body: JSON.stringify({ status: c.scheduled_for && new Date(c.scheduled_for) > new Date() ? "scheduled" : "approved" }) }).catch(() => {});
    throw e;
  }
}

// Sends one claimed row. Returns the new state of the row.
async function sendRow(row) {
  const member = { id: row.member_id, attendance_id: row.attendance_id, email_ok: !!row.attendance_id, full_name: row.recipient_name, email: row.channel === "email" ? row.recipient_address : null, phone: row.channel === "email" ? null : row.recipient_address };
  const out = await sendAll({ member, channels: [row.channel], subject: row.subject, message: row.body, kind: row.category || "announcement", queueId: row.id, attempt: row.attempts });   // row.attempts already counts this send (it was incremented when the row was claimed)
  const st = out[row.channel], why = out.reasons[row.channel];
  const now = new Date();
  if (st === "sent") return { status: "sent", sent_at: now.toISOString(), last_error: null };
  if (st === "skipped") return { status: "cancelled", last_error: why || "skipped" };            // consent, opt-out, test mode or provider not set up
  const attempts = row.attempts;
  if (out.retryable[row.channel] && attempts < row.max_attempts)
    return { status: "scheduled", next_attempt_at: new Date(now.getTime() + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60000).toISOString(), last_error: why };
  return { status: "failed", dead_lettered_at: now.toISOString(), last_error: why };
}

// A campaign is finished when none of its rows can still move. It counts as sent if at least one message went out.
async function finish(campaignId) {
  const open = await srv(`message_queue?campaign_id=eq.${campaignId}&status=in.(approved,scheduled,processing)&select=id&limit=1`);
  if (open.length) return null;
  const done = await srv(`message_queue?campaign_id=eq.${campaignId}&status=in.(sent,delivered)&select=id&limit=1`);
  const status = done.length ? "sent" : "failed";
  await srv(`campaigns?id=eq.${campaignId}&status=eq.processing`, { method: "PATCH", body: JSON.stringify({ status }) });
  return status;
}

// Rows left in 'processing' by a crashed run. Not resent: they may already have gone out.
async function recoverStale() {
  const old = enc(new Date(Date.now() - STALE_MS).toISOString());
  const rows = await srv(`message_queue?status=eq.processing&locked_at=lt.${old}`, { method: "PATCH", ...rep,
    body: JSON.stringify({ status: "failed", dead_lettered_at: new Date().toISOString(), last_error: "Stopped while sending. Not retried automatically so nobody gets it twice; check the Messages sent tab." }) });
  return [...new Set(rows.map((r) => r.campaign_id).filter(Boolean))];
}

// Sends due rows until the time budget or row limit is reached. Rows are handled one at a time, in order.
async function runBatch({ campaignId = null, limit = 20, budgetMs = 20000, workerId = "worker" } = {}) {
  const t0 = Date.now(), now = enc(new Date().toISOString()), scope = campaignId ? `&campaign_id=eq.${campaignId}` : "";
  const touched = new Set(await recoverStale());
  const fresh = await srv(`message_queue?status=eq.approved${scope}&order=created_at.asc&limit=${limit}`);
  const retries = await srv(`message_queue?status=eq.scheduled&next_attempt_at=lte.${now}${scope}&order=next_attempt_at.asc&limit=${limit}`);
  // Gmail suspends accounts that send too much, and bulk bursts look like spam. Past the daily cap, email rows simply wait for the next run.
  let emailsLeft = Infinity;
  const due = [...retries, ...fresh].slice(0, limit);
  if (due.some((r) => r.channel === "email")) {
    const since = enc(new Date(Date.now() - 864e5).toISOString());
    const used = (await srv(`message_log?channel=eq.email&status=in.(sent,delivered)&created_at=gte.${since}&select=id&limit=5000`)).length;
    emailsLeft = Math.max(0, emailDailyLimit() - used);
  }
  let handled = 0, held = 0;
  const one = async (row) => {
    if (Date.now() - t0 > budgetMs) return;
    if (row.channel === "email") { if (emailsLeft <= 0) { held++; return; } emailsLeft--; }
    const mine = await srv(`message_queue?id=eq.${row.id}&status=in.(approved,scheduled)&attempts=eq.${row.attempts}`, { method: "PATCH", ...rep,
      body: JSON.stringify({ status: "processing", locked_at: new Date().toISOString(), locked_by: workerId, attempts: row.attempts + 1 }) });
    if (!mine.length) return;                                                               // someone else has it
    let result;
    try { result = await sendRow(mine[0]); }
    catch (e) { result = { status: "failed", dead_lettered_at: new Date().toISOString(), last_error: String(e.message).slice(0, 300) }; }
    await srv(`message_queue?id=eq.${row.id}&status=eq.processing`, { method: "PATCH", body: JSON.stringify({ ...result, locked_at: null, locked_by: null }) });
    if (row.campaign_id) touched.add(row.campaign_id);
    handled++;
  };
  for (let i = 0; i < due.length; i += CONCURRENCY) await Promise.all(due.slice(i, i + CONCURRENCY).map(one));
  for (const id of touched) await finish(id);
  return { handled, heldForDailyLimit: held };
}

// Counts for the admin page.
async function progress(campaignId) {
  const rows = await srv(`message_queue?campaign_id=eq.${campaignId}&select=status,channel,last_error&limit=20000`);
  const by = {}, reasons = {};
  for (const r of rows) {
    by[r.status] = (by[r.status] || 0) + 1;
    if ((r.status === "cancelled" || r.status === "failed") && r.last_error) reasons[r.last_error] = (reasons[r.last_error] || 0) + 1;
  }
  const open = (by.approved || 0) + (by.scheduled || 0) + (by.processing || 0);
  return { total: rows.length, sent: (by.sent || 0) + (by.delivered || 0), failed: by.failed || 0, skipped: by.cancelled || 0, waiting: open, reasons };
}

// Campaigns whose send time has arrived (used by the daily job).
const dueCampaigns = () => srv(`campaigns?status=eq.scheduled&scheduled_for=lte.${enc(new Date().toISOString())}&select=*&limit=20`);

module.exports = { reach, loadContext, expandCampaign, runBatch, progress, finish, recoverStale, dueCampaigns, inAudience };
