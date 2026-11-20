// Checks the signed-in administrator on the server. Never trust a role sent by the browser.
const { SB } = require("./db");
const { K: ANON } = require("../_lib");

// Returns { id, email, role } or sends the error response and returns null.
async function adminAuth(req, res) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) { res.status(401).json({ error: "Please sign in again." }); return null; }
  const h = { apikey: ANON, Authorization: "Bearer " + token };
  const u = await fetch(`${SB()}/auth/v1/user`, { headers: h });
  if (!u.ok) { res.status(401).json({ error: "Session expired. Sign in again." }); return null; }
  const user = await u.json();
  const a = await fetch(`${SB()}/rest/v1/admins?select=role`, { headers: h });   // row-level security returns only the caller's own row
  const rows = a.ok ? await a.json() : [];
  if (!rows.length || !rows[0].role) { res.status(403).json({ error: "Administrators only." }); return null; }
  return { id: user.id, email: user.email || null, role: rows[0].role };
}

module.exports = { adminAuth };
