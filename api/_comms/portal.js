// Member portal API (READ ONLY). A member signs in with an emailed one-time link; this endpoint then shows THEIR OWN record.
//   POST /api/comms/portal   { action: "me" }
// The member is found by the signed-in, email-confirmed address. The browser never says which record to read.
// Members cannot change anything after registration: every change goes through a leader in the admin page.
const { SB, srv, hasSrv } = require("./db");
const { K: ANON } = require("../_lib");

const MEMBER_COLUMNS = "id,full_name,email,phone,department,faculty,course,level,status,intro,interests,bio,skills_business,hostel_address,photo_url,review_status,profile_approved,consent_public,date_of_birth,created_at";

class Bad extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }

// The signed-in user, or throws. The address must be confirmed, so nobody can claim someone else's record by typing their email.
async function who(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Bad("Please sign in.", 401);
  const r = await fetch(`${SB()}/auth/v1/user`, { headers: { apikey: ANON, Authorization: "Bearer " + token } });
  if (!r.ok) throw new Bad("Your session has expired. Please sign in again.", 401);
  const u = await r.json();
  if (!u.email) throw new Bad("This account has no email address.", 403);
  if (!u.email_confirmed_at) throw new Bad("Please confirm your email first. Open the confirmation email we sent you, then sign in again.", 403);
  return String(u.email).trim().toLowerCase();
}
async function mine(email) {
  const rows = await srv(`members?email=ilike.${encodeURIComponent(email)}&review_status=neq.rejected&select=${MEMBER_COLUMNS}&order=created_at.desc&limit=5`);
  const m = rows.find((x) => String(x.email).trim().toLowerCase() === email && x.review_status === "approved") || rows.find((x) => String(x.email).trim().toLowerCase() === email);
  if (!m) throw new Bad("We could not find a registration for this email. Register on the Contact page first, using the same email.", 404);
  return m;
}
async function history(id) {
  const att = await srv(`attendance?member_id=eq.${id}&select=session_id,created_at&order=created_at.desc&limit=50`);
  if (!att.length) return { attended: 0, recent: [] };
  const ids = att.map((a) => a.session_id).join(",");
  const s = await srv(`sessions?id=in.(${ids})&select=id,kind,session_date`);
  const by = Object.fromEntries(s.map((x) => [x.id, x]));
  const recent = att.map((a) => by[a.session_id]).filter(Boolean).sort((a, b) => String(b.session_date).localeCompare(String(a.session_date))).slice(0, 10).map((x) => ({ kind: x.kind, date: x.session_date }));
  return { attended: att.length, recent };
}
const view = (m) => { const { id, email, ...rest } = m; return { ...rest, email }; };

const actions = {
  async me(b, email) {
    const m = await mine(email);
    return { member: view(m), attendance: await history(m.id) };
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!hasSrv()) return res.status(503).json({ error: "Server setup is incomplete." });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const name = String(b.action || "");
  if (!Object.prototype.hasOwnProperty.call(actions, name)) return res.status(400).json({ error: "Unknown action." });
  try {
    const email = await who(req);
    res.status(200).json(await actions[name](b, email));
  } catch (e) {
    if (e instanceof Bad) return res.status(e.code).json({ error: e.message });
    console.error("portal failed:", e);
    res.status(500).json({ error: "Server error. Please try again." });
  }
};
