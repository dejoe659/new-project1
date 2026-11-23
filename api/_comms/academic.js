// Academic help: a student picks their faculty and department, describes the course problem, and the fellowship's faculty coordinators help.
//   Public:       { action: "faculties" | "submit" | "status" }
//   Staff:        { action: "access" | "list" | "get" | "update" }           (a super administrator, or a faculty coordinator limited to their faculties)
//   Super admin:  { action: "coords" | "coord_add" | "coord_update" | "coord_remove" | "dept_add" | "dept_remove" | "faculty_add" }
// Faculty coordinators are NOT rows in the admins table, so they have no database permissions. They only ever reach data through this file,
// which limits them to their own faculties and to the abilities the super administrator ticked for them.
const crypto = require("crypto");
const { SB, srv, hasSrv, adminHeaders } = require("./db");
const { K: ANON } = require("../_lib");
const { normalize } = require("./phone");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LEVELS = ["100", "200", "300", "400", "500", "600", "Postgraduate"];
const STATUSES = ["new", "in_progress", "resolved", "closed"];
const PUBLIC_STATUS = { new: "Received", in_progress: "A coordinator is looking into it", resolved: "Marked as resolved", closed: "Closed" };
const HOURLY_LIMIT = 5, ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", enc = encodeURIComponent;
class Bad extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const newCode = () => { const b = crypto.randomBytes(12); let c = ""; for (let i = 0; i < 12; i++) c += ALPHABET[b[i] % ALPHABET.length]; return c; };
const pretty = (c) => c.match(/.{4}/g).join("-");
const hash = (c) => crypto.createHash("sha256").update("dcf-acad:" + String(c).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
const ipHash = (req) => { const ip = String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "unknown").split(",")[0].trim(); return crypto.createHash("sha256").update("dcf-ip:" + ip).digest("hex"); };
const tempPassword = () => { const b = crypto.randomBytes(14); let p = ""; for (let i = 0; i < 14; i++) p += ALPHABET[b[i] % ALPHABET.length]; return p.slice(0, 4) + "-" + p.slice(4, 9) + "-" + p.slice(9); };

async function audit(me, action, id, details = {}) {
  try { await srv("admin_audit_logs", { method: "POST", body: JSON.stringify({ admin_user_id: me.id, admin_email: me.email, admin_role: me.kind === "super" ? "super_admin" : "faculty_coordinator", action, entity: "academic_request", entity_id: id || null, details }) }); }
  catch (e) { console.error("academic audit not written:", action, e.message); }
}

// Who is asking? A super administrator, an active faculty coordinator, or nobody. The role comes from the server, never from the browser.
async function identify(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const h = { apikey: ANON, Authorization: "Bearer " + token };
  const u = await fetch(`${SB()}/auth/v1/user`, { headers: h });
  if (!u.ok) return null;
  const user = await u.json(), email = String(user.email || "").toLowerCase();
  const a = await fetch(`${SB()}/rest/v1/admins?select=role`, { headers: h });
  const rows = a.ok ? await a.json() : [];
  if (rows[0] && rows[0].role === "super_admin") return { kind: "super", id: user.id, email };
  const c = (await srv(`academic_coordinators?email=eq.${enc(email)}&select=*&limit=1`))[0];
  if (c && c.active) return { kind: "coord", id: user.id, email, coord: c };
  return null;
}
const scopeIds = (me) => (me.kind === "super" ? null : new Set(me.coord.faculty_ids || []));
const inScope = (me, r) => { const s = scopeIds(me); return !s || s.has(r.faculty_id); };
const canUpdate = (me) => me.kind === "super" || me.coord.can_update;
const canContact = (me) => me.kind === "super" || me.coord.can_view_contact;

const catalog = async () => {
  const [fs, ds] = await Promise.all([srv("faculties?select=id,name&order=name.asc&limit=100"), srv("departments?select=id,faculty_id,name&order=name.asc&limit=1000")]);
  return fs.map((f) => ({ id: f.id, name: f.name, departments: ds.filter((d) => d.faculty_id === f.id).map((d) => ({ id: d.id, name: d.name })) }));
};

// ---------- public
const pub = {
  async faculties() { return { faculties: await catalog() }; },
  async submit(b, req) {
    if (b.website) return { message: "Thank you." };
    if (!UUID.test(String(b.faculty_id || ""))) throw new Bad("Choose your faculty.");
    const fac = (await srv(`faculties?id=eq.${b.faculty_id}&select=id,name&limit=1`))[0];
    if (!fac) throw new Bad("Choose your faculty.");
    let department_id = null;
    if (b.department_id) {
      if (!UUID.test(String(b.department_id))) throw new Bad("Choose your department.");
      const d = (await srv(`departments?id=eq.${b.department_id}&select=id,faculty_id&limit=1`))[0];
      if (!d || d.faculty_id !== fac.id) throw new Bad("That department is not in the faculty you chose.");
      department_id = d.id;
    }
    const name = text(b.name, 120), course = text(b.course, 150), issue = text(b.issue, 3000);
    if (name.length < 2) throw new Bad("Please enter your name.");
    if (course.length < 2) throw new Bad("Which course are you having trouble with?");
    if (issue.length < 5) throw new Bad("Please tell us a little more about the problem.");
    const level = LEVELS.includes(b.level) ? b.level : null;
    let phone = null, email = null;
    if (b.phone) { if (!normalize(String(b.phone)).ok) throw new Bad("That phone number is not valid."); phone = text(String(b.phone), 30); }
    if (b.email) { email = text(b.email, 200).toLowerCase(); if (!EMAIL_RE.test(email)) throw new Bad("That email address is not valid."); }
    if (!phone && !email) throw new Bad("Please give a phone number or email so a coordinator can reach you.");
    const ip = ipHash(req), since = enc(new Date(Date.now() - 36e5).toISOString());
    const recent = await srv(`academic_requests?ip_hash=eq.${ip}&created_at=gte.${since}&select=id&limit=50`);
    if (recent.length >= HOURLY_LIMIT) throw new Bad("You have sent several requests in the last hour. Please try again later.", 429);
    const code = newCode();
    await srv("academic_requests", { method: "POST", body: JSON.stringify({ code_hash: hash(code), faculty_id: fac.id, department_id, course, level, issue, name, phone, email, ip_hash: ip }) });
    notifyTeam(fac.name).catch(() => {});
    return { code: pretty(code), message: "Your request was received and sent to the coordinator for your faculty. Keep this code safe: it is the only way to check on your request, and we cannot show it again." };
  },
  async status(b) {
    const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 12) throw new Bad("Enter the 12-character code you were given.");
    const r = (await srv(`academic_requests?code_hash=eq.${hash(code)}&select=status,created_at&limit=1`))[0];
    if (!r) throw new Bad("We could not find a request with that code.", 404);
    return { received: r.created_at, status: PUBLIC_STATUS[r.status] || "Received" };
  },
};
async function notifyTeam(faculty) {
  const { mail } = require("../_lib");
  await mail("New academic help request", `A student in the Faculty of ${faculty} asked for help with a course. Faculty coordinators can open it at /coordinator. (The request itself is never sent by email.)`);
}

// ---------- staff
const view = (r, cat, me) => {
  const f = cat.find((x) => x.id === r.faculty_id), d = f && f.departments.find((x) => x.id === r.department_id);
  const o = { id: r.id, faculty: f ? f.name : "?", department: d ? d.name : "Not listed", course: r.course, level: r.level, status: r.status, name: r.name, created_at: r.created_at };
  return o;
};
const staff = {
  async access(b, req, me) {
    const cat = await catalog(), s = scopeIds(me);
    return { role: me.kind === "super" ? "super_admin" : "coordinator", name: me.kind === "coord" ? me.coord.name : null, can_update: canUpdate(me), can_view_contact: canContact(me), faculties: cat.filter((f) => !s || s.has(f.id)).map((f) => ({ id: f.id, name: f.name })) };
  },
  async list(b, req, me) {
    const cat = await catalog();
    const st = STATUSES.includes(b.status) ? `&status=eq.${b.status}` : "";
    const rows = await srv(`academic_requests?select=id,faculty_id,department_id,course,level,status,name,created_at${st}&order=created_at.desc&limit=300`);
    return { requests: rows.filter((r) => inScope(me, r)).map((r) => view(r, cat, me)) };
  },
  async get(b, req, me) {
    if (!UUID.test(String(b.id || ""))) throw new Bad("Unknown request.");
    const r = (await srv(`academic_requests?id=eq.${b.id}&select=*&limit=1`))[0];
    if (!r || !inScope(me, r)) throw new Bad("That request was not found.", 404);
    const cat = await catalog(), out = { ...view(r, cat, me), issue: r.issue, coordinator_note: r.coordinator_note, handled_by: r.handled_by, updated_at: r.updated_at };
    if (canContact(me)) { out.phone = r.phone; out.email = r.email; } else out.contact_hidden = true;
    await audit(me, "academic.view", r.id, { faculty_id: r.faculty_id });
    return { request: out };
  },
  async update(b, req, me) {
    if (!canUpdate(me)) throw new Bad("You can read requests but you have not been given permission to change them.", 403);
    if (!UUID.test(String(b.id || ""))) throw new Bad("Unknown request.");
    const r = (await srv(`academic_requests?id=eq.${b.id}&select=id,faculty_id,status&limit=1`))[0];
    if (!r || !inScope(me, r)) throw new Bad("That request was not found.", 404);
    const patch = { updated_at: new Date().toISOString(), handled_by: me.email };
    if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw new Bad("Unknown status."); patch.status = b.status; }
    if (b.coordinator_note !== undefined) patch.coordinator_note = text(b.coordinator_note, 2000) || null;
    await srv(`academic_requests?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await audit(me, "academic.update", r.id, { status: patch.status || r.status, note_changed: b.coordinator_note !== undefined });
    return { ok: true };
  },
};

// ---------- super administrator only
const validFaculties = async (ids) => {
  if (!Array.isArray(ids) || !ids.length) throw new Bad("Choose at least one faculty for this coordinator.");
  const all = await srv("faculties?select=id&limit=100"), ok = new Set(all.map((f) => f.id));
  const clean = [...new Set(ids.map(String))];
  if (!clean.every((i) => UUID.test(i) && ok.has(i))) throw new Bad("Unknown faculty.");
  return clean;
};
const boss = {
  async coords() { return { coordinators: await srv("academic_coordinators?select=id,email,name,faculty_ids,can_view_contact,can_update,active,created_at&order=created_at.asc&limit=200") }; },
  async coord_add(b, req, me) {
    const email = text(b.email, 200).toLowerCase(), name = text(b.name, 120) || null;
    if (!EMAIL_RE.test(email)) throw new Bad("Enter a valid email address.");
    const faculty_ids = await validFaculties(b.faculty_ids);
    if ((await srv(`academic_coordinators?email=eq.${enc(email)}&select=id&limit=1`)).length) throw new Bad("That person is already a coordinator. Edit them instead.", 409);
    // Create the sign-in. If the email already has a login, keep it and show no password.
    const pw = tempPassword();
    const r = await fetch(`${SB()}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ email, password: pw, email_confirm: true }) });
    let created = r.ok;
    if (!r.ok && r.status !== 422) throw new Bad("Could not create the login. Please try again.", 502);
    await srv("academic_coordinators", { method: "POST", body: JSON.stringify({ email, name, faculty_ids, can_view_contact: b.can_view_contact !== false, can_update: b.can_update !== false, added_by: me.email }) });
    await audit(me, "academic.coord_add", null, { email, faculties: faculty_ids.length });
    return { ok: true, login_created: created, temp_password: created ? pw : null };
  },
  async coord_update(b, req, me) {
    if (!UUID.test(String(b.id || ""))) throw new Bad("Unknown coordinator.");
    const patch = {};
    if (b.faculty_ids !== undefined) patch.faculty_ids = await validFaculties(b.faculty_ids);
    for (const k of ["can_view_contact", "can_update", "active"]) if (b[k] !== undefined) patch[k] = b[k] === true;
    if (b.name !== undefined) patch.name = text(b.name, 120) || null;
    if (!Object.keys(patch).length) throw new Bad("Nothing to change.");
    await srv(`academic_coordinators?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await audit(me, "academic.coord_update", null, { id: b.id, fields: Object.keys(patch) });
    return { ok: true };
  },
  async coord_remove(b, req, me) {
    if (!UUID.test(String(b.id || ""))) throw new Bad("Unknown coordinator.");
    await srv(`academic_coordinators?id=eq.${b.id}`, { method: "DELETE" });
    await audit(me, "academic.coord_remove", null, { id: b.id });
    return { ok: true };
  },
  async faculty_add(b, req, me) {
    const name = text(b.name, 120); if (name.length < 2) throw new Bad("Enter the faculty name.");
    await srv("faculties", { method: "POST", body: JSON.stringify({ name }) });
    await audit(me, "academic.faculty_add", null, { name });
    return { ok: true };
  },
  async dept_add(b, req, me) {
    const name = text(b.name, 150); if (name.length < 2) throw new Bad("Enter the department name.");
    if (!UUID.test(String(b.faculty_id || ""))) throw new Bad("Choose a faculty.");
    await srv("departments", { method: "POST", body: JSON.stringify({ faculty_id: b.faculty_id, name }) });
    await audit(me, "academic.dept_add", null, { name });
    return { ok: true };
  },
  async dept_remove(b, req, me) {
    if (!UUID.test(String(b.id || ""))) throw new Bad("Unknown department.");
    await srv(`departments?id=eq.${b.id}`, { method: "DELETE" });
    await audit(me, "academic.dept_remove", null, { id: b.id });
    return { ok: true };
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const name = String(b.action || "");
  const has = (o) => Object.prototype.hasOwnProperty.call(o, name);
  if (!has(pub) && !has(staff) && !has(boss)) return res.status(400).json({ error: "Unknown action." });
  if (!hasSrv()) return res.status(503).json({ error: "Server setup is incomplete." });
  try {
    if (has(pub)) return res.status(200).json(await pub[name](b, req));
    const me = await identify(req);
    if (!me) return res.status(403).json({ error: "You do not have access. Sign in with a coordinator account." });
    if (has(boss)) { if (me.kind !== "super") return res.status(403).json({ error: "Only a super administrator can do that." }); return res.status(200).json(await boss[name](b, req, me)); }
    return res.status(200).json(await staff[name](b, req, me));
  } catch (e) {
    if (e instanceof Bad) return res.status(e.code).json({ error: e.message });
    console.error("academic failed:", e);
    res.status(500).json({ error: "Server error. Please try again." });
  }
};
