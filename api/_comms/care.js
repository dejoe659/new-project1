// Prayer and counselling centre. PRIVATE by design.
//   Public:  POST /api/comms/care { action: "submit" | "status" }
//   Team:    POST /api/comms/care { action: "access" | "list" | "get" | "update" | "delete" }   (signed-in administrator who is on the care team)
//   Super admin only: { action: "team" | "team_add" | "team_remove" }
// The database tables cannot be read by the public or by the normal admin login. Only this server code reads them, and it checks who is asking.
//   - Counselling requests are only ever visible to counsellors.
//   - A prayer request marked "counsellors only" is only visible to counsellors; otherwise the prayer team and counsellors see it.
//   - Being a super administrator does NOT by itself allow reading requests. A person must be added to the care team.
//   - Every time someone opens, changes or deletes a request, it is written to the audit log (never the content).
const crypto = require("crypto");
const { srv, hasSrv } = require("./db");
const { adminAuth } = require("./admin-auth");
const { normalize } = require("./phone");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CATEGORIES = ["Spiritual growth", "Academics", "Health", "Family", "Relationships", "Finances", "Accommodation", "Other"];
const STATUSES = ["new", "in_progress", "prayed", "follow_up", "closed"];
const PUBLIC_STATUS = { new: "Received", in_progress: "Being looked at by our team", prayed: "We have prayed over your request", follow_up: "A member of our team will follow up", closed: "Closed. God bless you" };
const HOURLY_LIMIT = 5;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";                                    // no 0/O/1/I
const enc = encodeURIComponent;
class Bad extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const newCode = () => { const b = crypto.randomBytes(12); let c = ""; for (let i = 0; i < 12; i++) c += ALPHABET[b[i] % ALPHABET.length]; return c; };
const pretty = (c) => c.match(/.{4}/g).join("-");
const hash = (c) => crypto.createHash("sha256").update("dcf-care:" + String(c).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
const ipHash = (req) => { const ip = String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "unknown").split(",")[0].trim(); return crypto.createHash("sha256").update("dcf-ip:" + ip).digest("hex"); };

async function audit(me, action, id, details = {}) {
  try { await srv("admin_audit_logs", { method: "POST", body: JSON.stringify({ admin_user_id: me.id, admin_email: me.email, admin_role: me.role, action, entity: "care_request", entity_id: id || null, details }) }); }
  catch (e) { console.error("care audit not written:", action, e.message); }
}

// ---------- public
const pub = {
  async submit(b, req) {
    if (b.website) return { message: "Thank you." };                                          // honeypot
    const kind = b.kind === "counselling" ? "counselling" : b.kind === "prayer" ? "prayer" : null;
    if (!kind) throw new Bad("Choose prayer request or counselling.");
    const category = CATEGORIES.includes(b.category) ? b.category : "Other";
    const message = text(b.message, 3000);
    if (message.length < 5) throw new Bad("Please tell us a little more about your request.");
    const anonymous = b.anonymous === true;
    let name = null, phone = null, email = null;
    if (!anonymous) {
      name = text(b.name, 120) || null;
      if (b.phone) { const p = normalize(String(b.phone)); if (!p.ok) throw new Bad("That phone number is not valid. Leave it blank if you prefer."); phone = text(String(b.phone), 30); }
      if (b.email) { email = text(b.email, 200).toLowerCase(); if (!EMAIL_RE.test(email)) throw new Bad("That email address is not valid. Leave it blank if you prefer."); }
      if (kind === "counselling" && !phone && !email) throw new Bad("For counselling, please give a phone number or email so a counsellor can reach you, or choose to stay anonymous.");
    }
    const privacy = kind === "counselling" || b.privacy === "counsellors_only" ? "counsellors_only" : "prayer_team";
    const ip = ipHash(req), since = enc(new Date(Date.now() - 36e5).toISOString());
    const recent = await srv(`care_requests?ip_hash=eq.${ip}&created_at=gte.${since}&select=id&limit=50`);
    if (recent.length >= HOURLY_LIMIT) throw new Bad("You have sent several requests in the last hour. Please try again later.", 429);
    const code = newCode();
    await srv("care_requests", { method: "POST", body: JSON.stringify({ code_hash: hash(code), kind, category, anonymous, name, phone, email, message, privacy, ip_hash: ip }) });
    notifyTeam(kind).catch(() => {});                                                          // a heads-up with NO content
    return { code: pretty(code), message: "Your request was received. Keep this code safe: it is the only way to check on your request, and we cannot show it again." };
  },
  async status(b) {
    const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 12) throw new Bad("Enter the 12-character code you were given.");
    const r = (await srv(`care_requests?code_hash=eq.${hash(code)}&select=kind,status,created_at&limit=1`))[0];
    if (!r) throw new Bad("We could not find a request with that code.", 404);
    return { kind: r.kind, received: r.created_at, status: PUBLIC_STATUS[r.status] || "Received" };
  },
};
async function notifyTeam(kind) {
  const { mail } = require("../_lib");
  await mail(`New ${kind === "counselling" ? "counselling" : "prayer"} request`, `A new ${kind} request was received. Open Admin > Care to see it. (The request itself is never sent by email.)`);
}

// ---------- team
const myRole = async (me) => {
  const rows = await srv(`care_team?email=eq.${enc(String(me.email || "").toLowerCase())}&select=role&limit=1`);
  return rows[0] ? rows[0].role : null;
};
const canSee = (role, r) => role === "counsellor" || (role === "prayer" && r.kind === "prayer" && r.privacy === "prayer_team");
const summary = (r) => ({ id: r.id, kind: r.kind, category: r.category, status: r.status, privacy: r.privacy, created_at: r.created_at, who: r.anonymous || !r.name ? "Anonymous" : r.name });
const needRole = async (me) => { const role = await myRole(me); if (!role) throw new Bad("You are not on the care team. Ask a super administrator to add you.", 403); return role; };
const load = async (id, role) => {
  if (!UUID.test(String(id || ""))) throw new Bad("Unknown request.");
  const r = (await srv(`care_requests?id=eq.${id}&select=id,kind,category,anonymous,name,phone,email,message,privacy,status,team_note,handled_by,created_at,updated_at&limit=1`))[0];
  if (!r || !canSee(role, r)) throw new Bad("That request was not found.", 404);               // same answer whether it is missing or not yours
  return r;
};
const team = {
  async access(b, req, me) { const role = await myRole(me); return { role, super_admin: me.role === "super_admin" }; },
  async list(b, req, me) {
    const role = await needRole(me);
    const st = STATUSES.includes(b.status) ? `&status=eq.${b.status}` : "";
    const rows = await srv(`care_requests?select=id,kind,category,anonymous,name,privacy,status,created_at${st}&order=created_at.desc&limit=300`);
    return { role, requests: rows.filter((r) => canSee(role, r)).map(summary) };
  },
  async get(b, req, me) {
    const role = await needRole(me); const r = await load(b.id, role);
    await audit(me, "care.view", r.id, { kind: r.kind, role });
    return { request: r };
  },
  async update(b, req, me) {
    const role = await needRole(me); const r = await load(b.id, role);
    const patch = { updated_at: new Date().toISOString(), handled_by: me.email };
    if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw new Bad("Unknown status."); patch.status = b.status; }
    if (b.team_note !== undefined) patch.team_note = text(b.team_note, 2000) || null;
    await srv(`care_requests?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await audit(me, "care.update", r.id, { status: patch.status || r.status, note_changed: b.team_note !== undefined });
    return { ok: true };
  },
  async delete(b, req, me) {
    const role = await needRole(me); const r = await load(b.id, role);
    if (role !== "counsellor") throw new Bad("Only a counsellor can delete a request.", 403);
    if (r.status !== "closed") throw new Bad("Close the request before deleting it.", 409);
    await srv(`care_requests?id=eq.${r.id}`, { method: "DELETE" });
    await audit(me, "care.delete", r.id, { kind: r.kind });
    return { ok: true };
  },
};
const admin = {
  async team(b, req, me) { return { team: await srv("care_team?select=id,email,role,created_at&order=created_at.asc&limit=100") }; },
  async team_add(b, req, me) {
    const email = text(b.email, 200).toLowerCase(), role = b.role === "counsellor" ? "counsellor" : b.role === "prayer" ? "prayer" : null;
    if (!EMAIL_RE.test(email)) throw new Bad("Enter a valid email address.");
    if (!role) throw new Bad("Choose prayer team or counsellor.");
    const exists = await srv(`care_team?email=eq.${enc(email)}&select=id&limit=1`);
    if (exists.length) throw new Bad("That person is already on the care team. Remove them first to change their role.", 409);
    await srv("care_team", { method: "POST", body: JSON.stringify({ email, role, added_by: me.email }) });
    await audit(me, "care.team_add", null, { email, role });
    return { ok: true };
  },
  async team_remove(b, req, me) {
    if (!UUID.test(String(b.id || ""))) throw new Bad("Unknown team member.");
    const row = (await srv(`care_team?id=eq.${b.id}&select=email,role&limit=1`))[0];
    if (!row) throw new Bad("Team member not found.", 404);
    await srv(`care_team?id=eq.${b.id}`, { method: "DELETE" });
    await audit(me, "care.team_remove", null, { email: row.email, role: row.role });
    return { ok: true };
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const name = String(b.action || "");
  const has = (o) => Object.prototype.hasOwnProperty.call(o, name);
  if (!has(pub) && !has(team) && !has(admin)) return res.status(400).json({ error: "Unknown action." });
  if (!hasSrv()) return res.status(503).json({ error: "Server setup is incomplete." });
  try {
    if (has(pub)) return res.status(200).json(await pub[name](b, req));
    const me = await adminAuth(req, res); if (!me) return;                                    // sends 401/403 itself
    if (has(admin)) { if (me.role !== "super_admin") return res.status(403).json({ error: "Only a super administrator can manage the care team." }); return res.status(200).json(await admin[name](b, req, me)); }
    return res.status(200).json(await team[name](b, req, me));
  } catch (e) {
    if (e instanceof Bad) return res.status(e.code).json({ error: e.message });
    console.error("care failed:", e);
    res.status(500).json({ error: "Server error. Please try again." });
  }
};
module.exports.hash = hash;
