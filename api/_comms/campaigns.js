// Phase 4: draft, submit, approve or reject announcements ("campaigns"). Nothing here sends a message.
// Phase 5 will pick up campaigns whose status is 'approved' or 'scheduled'.
// POST /api/comms/campaigns   { action: list | get | save | submit | approve | reject | cancel, ... }
//   list, get                 any administrator (moderators are read-only)
//   save, submit, cancel      super_admin, content_admin
//   approve, reject           super_admin only
const { srv, hasSrv } = require("./db");
const { adminAuth } = require("./admin-auth");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ["email", "sms", "whatsapp"];
const LIMITS = { title: 120, description: 1000, venue: 120, url: 300, subject: 150, email: 5000, sms: 320, whatsapp: 1000, note: 500 };
const EDITABLE = ["draft", "pending_approval", "rejected"];
const WRITERS = ["super_admin", "content_admin"];
const WRITE_ACTIONS = ["save", "submit", "cancel"];

class Bad extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Validates what an administrator typed. Returns clean values for the database or throws Bad.
function cleanInput(b) {
  const title = text(b.title, LIMITS.title);
  if (!title) throw new Bad("Give the message a title.");
  const channels = [...new Set((Array.isArray(b.channels) ? b.channels : []).filter((c) => CHANNELS.includes(c)))];
  const c = b.content && typeof b.content === "object" ? b.content : {};
  const content = {};
  if (channels.includes("email")) {
    content.email_subject = text(c.email_subject, LIMITS.subject);
    content.email_body = text(c.email_body, LIMITS.email);
  }
  if (channels.includes("sms")) content.sms = text(c.sms, LIMITS.sms);
  if (channels.includes("whatsapp")) content.whatsapp = text(c.whatsapp, LIMITS.whatsapp);
  const a = b.audience && typeof b.audience === "object" ? b.audience : {};
  const list = (v, n, max) => [...new Set((Array.isArray(v) ? v : []).map((x) => text(x, max)).filter(Boolean))].slice(0, n);
  const audience = { all_members: a.all_members === true, levels: list(a.levels, 10, 10), departments: list(a.departments, 20, 60) };
  let scheduled_for = null;
  if (b.scheduled_for) {
    const d = new Date(b.scheduled_for);
    if (Number.isNaN(d.getTime())) throw new Bad("The scheduled time is not a valid date.");
    scheduled_for = d.toISOString();
  }
  let event_at = null;
  if (b.event_at) {
    const d = new Date(b.event_at);
    if (Number.isNaN(d.getTime())) throw new Bad("The event date is not a valid date.");
    event_at = d.toISOString();
  }
  const url = text(b.registration_url, LIMITS.url);
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw new Bad("The registration link must start with https://");
  return { title, description: text(b.description, LIMITS.description) || null, venue: text(b.venue, LIMITS.venue) || null,
    registration_url: url || null, event_at, channels, content, audience, scheduled_for };
}

// A campaign may only move forward when it is complete. Checked again at submit and approve, not just at save.
function problems(row) {
  const out = [];
  const ch = row.channels || [], c = row.content || {}, a = row.audience || {};
  if (!row.title) out.push("a title");
  if (!ch.length) out.push("at least one channel");
  if (ch.includes("email") && (!c.email_subject || !c.email_body)) out.push("an email subject and body");
  if (ch.includes("sms") && !c.sms) out.push("the SMS text");
  if (ch.includes("whatsapp") && !c.whatsapp) out.push("the WhatsApp text");
  if (!(a.all_members === true || (a.levels || []).length || (a.departments || []).length)) out.push("an audience (everyone, or a level or department)");
  if (row.scheduled_for && new Date(row.scheduled_for).getTime() <= Date.now() - 60000) out.push("a send time in the future");
  return out;
}
const mustBeComplete = (row) => { const p = problems(row); if (p.length) throw new Bad("Before this can go forward it needs " + p.join(", ") + "."); };

const rep = { headers: { Prefer: "return=representation" }, json: true };
const stamp = (row) => encodeURIComponent(row.updated_at);

async function record(me, campaign, action, extra = {}) {
  // Best effort: the status change has already happened, so a logging failure is reported to the server log, not hidden.
  try {
    await srv("message_approvals", { method: "POST", body: JSON.stringify({ campaign_id: campaign.id, action, admin_user_id: me.id, admin_email: me.email, admin_role: me.role, ...extra }) });
    await srv("admin_audit_logs", { method: "POST", body: JSON.stringify({ admin_user_id: me.id, admin_email: me.email, admin_role: me.role, action: "campaign." + action, entity: "campaign", entity_id: campaign.id, details: { title: campaign.title, status: campaign.status } }) });
  } catch (e) { console.error("approval trail not written for campaign", campaign.id, action, e.message); }
}

async function load(id) {
  if (!UUID.test(String(id || ""))) throw new Bad("Unknown message.");
  const rows = await srv(`campaigns?id=eq.${id}&select=*`);
  if (!rows.length) throw new Bad("That message was not found.", 404);
  return rows[0];
}

// Change status only if the row is still in an expected state (and, for approvals, still exactly what the approver saw).
async function move(row, from, patch, seen) {
  const guard = seen ? `&updated_at=eq.${encodeURIComponent(seen)}` : "";
  const hit = await srv(`campaigns?id=eq.${row.id}&status=in.(${from.join(",")})${guard}`, { method: "PATCH", body: JSON.stringify(patch), ...rep });
  if (!hit.length) throw new Bad("This message was changed by someone else. Reload and check it again.", 409);
  return hit[0];
}

const actions = {
  async list() {
    return { campaigns: await srv("campaigns?select=*&order=created_at.desc&limit=100") };
  },
  async get(b) {
    const campaign = await load(b.id);
    const approvals = await srv(`message_approvals?campaign_id=eq.${campaign.id}&select=*&order=created_at.asc`);
    return { campaign, approvals };
  },
  async save(b, me) {
    const d = cleanInput(b);
    if (!b.id) {
      const rows = await srv("campaigns", { method: "POST", body: JSON.stringify({ ...d, status: "draft", created_by: me.id }), ...rep });
      await record(me, rows[0], "edited", { note: "Draft created", body_after: JSON.stringify(d.content) });
      return { campaign: rows[0] };
    }
    const before = await load(b.id);
    if (!EDITABLE.includes(before.status)) throw new Bad("This message is already " + before.status.replace("_", " ") + " and can no longer be edited.", 409);
    // Any edit sends a message back to draft, so an approval always covers exactly the wording that was approved.
    const campaign = await move(before, EDITABLE, { ...d, status: "draft", approved_by: null, approved_at: null }, b.updated_at || before.updated_at);
    await record(me, campaign, "edited", { body_before: JSON.stringify(before.content), body_after: JSON.stringify(d.content) });
    return { campaign };
  },
  async submit(b, me) {
    const row = await load(b.id);
    mustBeComplete(row);
    const campaign = await move(row, ["draft", "rejected"], { status: "pending_approval" }, b.updated_at || row.updated_at);
    await record(me, campaign, "submitted", { note: text(b.note, LIMITS.note) || null });
    return { campaign };
  },
  async approve(b, me) {
    if (!b.updated_at) throw new Bad("Reload the message before approving it.");
    const row = await load(b.id);
    mustBeComplete(row);
    const later = row.scheduled_for && new Date(row.scheduled_for).getTime() > Date.now();
    const campaign = await move(row, ["pending_approval"],
      { status: later ? "scheduled" : "approved", approved_by: me.id, approved_at: new Date().toISOString() }, b.updated_at);
    await record(me, campaign, later ? "scheduled" : "approved", { note: text(b.note, LIMITS.note) || null, body_after: JSON.stringify(row.content) });
    return { campaign };
  },
  async reject(b, me) {
    if (!b.updated_at) throw new Bad("Reload the message before rejecting it.");
    const note = text(b.note, LIMITS.note);
    if (!note) throw new Bad("Say why it is being sent back, so the writer can fix it.");
    const row = await load(b.id);
    const campaign = await move(row, ["pending_approval"], { status: "rejected", approved_by: null, approved_at: null }, b.updated_at);
    await record(me, campaign, "rejected", { note });
    return { campaign };
  },
  async cancel(b, me) {
    const row = await load(b.id);
    const campaign = await move(row, ["draft", "pending_approval", "rejected", "approved", "scheduled"], { status: "cancelled" });
    await record(me, campaign, "cancelled", { note: text(b.note, LIMITS.note) || null });
    return { campaign };
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const me = await adminAuth(req, res);
  if (!me) return;
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const name = String(b.action || "");
  if (!Object.prototype.hasOwnProperty.call(actions, name)) return res.status(400).json({ error: "Unknown action." });
  if (WRITE_ACTIONS.includes(name) && !WRITERS.includes(me.role)) return res.status(403).json({ error: "Your role can view messages but not change them." });
  if ((name === "approve" || name === "reject") && me.role !== "super_admin") return res.status(403).json({ error: "Only a super admin can approve or reject messages." });
  if (!hasSrv()) return res.status(503).json({ error: "Server setup is incomplete: the Supabase secret key (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY) is missing in Vercel." });
  try {
    res.status(200).json(await actions[name](b, me));
  } catch (e) {
    if (e instanceof Bad) return res.status(e.code).json({ error: e.message });
    console.error("campaigns failed:", e);
    res.status(500).json({ error: "Server error. Check the Vercel function logs." });
  }
};
module.exports.problems = problems;
