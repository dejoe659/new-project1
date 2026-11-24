// Backup download (CSV), super administrators only. GET /api/comms/export?table=members|attendance|events|event_registrations|testimonies
// Private care and academic requests are deliberately NOT exportable.
const { srv, hasSrv } = require("./db");
const { adminAuth } = require("./admin-auth");
const TABLES = {
  members: "id,created_at,full_name,email,phone,department,faculty,course,level,review_status,profile_approved,consent_comms,reg_pref_whatsapp,reg_pref_sms,reg_pref_email,date_of_birth,state_of_origin,local_government,skills_business,hostel_address",
  attendance: "id,session_id,member_id,visitor_name,visitor_phone,visitor_email,method,created_at",
  events: "id,title,venue,starts_at,capacity,registration_open,created_at",
  event_registrations: "id,event_id,full_name,phone,email,attended,created_at",
  testimonies: "id,created_at,name,title,category,status",
};
// Spreadsheet programs run a cell that starts with = + - @ as a formula: neutralise it.
const cell = (v) => { if (v === null || v === undefined) return ""; let t = String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const toCsv = (cols, rows) => [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!hasSrv()) return res.status(503).json({ error: "Server setup is incomplete." });
  try {
    const me = await adminAuth(req, res); if (!me) return;
    if (me.role !== "super_admin") return res.status(403).json({ error: "Only a super administrator can download backups." });
    const t = String((req.query && req.query.table) || "");
    if (!Object.prototype.hasOwnProperty.call(TABLES, t)) return res.status(400).json({ error: "Unknown table." });
    const rows = []; for (let o = 0; o < 50000; o += 1000) { const r = await srv(`${t}?select=${TABLES[t]}&order=created_at.asc&limit=1000&offset=${o}`); rows.push(...r); if (r.length < 1000) break; }
    try { await srv("admin_audit_logs", { method: "POST", body: JSON.stringify({ admin_user_id: me.id || null, admin_email: me.email || null, admin_role: "super_admin", action: "export." + t, entity: t, details: { rows: rows.length } }) }); } catch (e) { console.error("export audit not written:", e.message); }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dcf-${t}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.status(200).send("﻿" + toCsv(TABLES[t].split(","), rows));
  } catch (e) { console.error("export failed:", e); res.status(500).json({ error: "Could not prepare the download." }); }
};
module.exports.toCsv = toCsv;
