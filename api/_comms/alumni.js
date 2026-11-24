// Alumni directory and mentor requests.
//   Public: { action: "list" | "join" | "mentor_request" }   Admin (super or content admin): { action: "admin_list" | "admin_set" | "admin_delete" | "req_list" | "req_set" }
// The public list never includes email or phone. Contact details are visible to administrators only, who introduce alumni and students.
const crypto = require("crypto");
const { srv, hasSrv } = require("./db");
const { adminAuth } = require("./admin-auth");
const { normalize } = require("./phone");
const { mailTo } = require("../_lib");
const SITE = "https://dcf-unn-site.vercel.app";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HOURLY_LIMIT = 5, enc = encodeURIComponent;
class Bad extends Error { constructor(m, c = 400) { super(m); this.code = c; } }
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ipHash = (req) => { const ip = String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "unknown").split(",")[0].trim(); return crypto.createHash("sha256").update("dcf-ip:" + ip).digest("hex"); };
const names = async () => { const { catalog } = require("./academic"); const cat = await catalog(); const f = {}, d = {}; for (const x of cat) { f[x.id] = x.name; for (const y of x.departments) d[y.id] = y.name; } return { f, d, cat }; };
const limited = async (table, ip) => (await srv(`${table}?ip_hash=eq.${ip}&created_at=gte.${enc(new Date(Date.now() - 36e5).toISOString())}&select=id&limit=50`)).length >= HOURLY_LIMIT;

const pub = {
  async list() {
    const [rows, n] = await Promise.all([srv("alumni?status=eq.approved&consent_public=eq.true&select=id,full_name,graduation_year,faculty_id,department_id,occupation,location,bio,mentor&order=graduation_year.desc&limit=500"), names()]);
    return { alumni: rows.map((a) => ({ id: a.id, full_name: a.full_name, graduation_year: a.graduation_year, faculty: n.f[a.faculty_id] || "", department: n.d[a.department_id] || "", occupation: a.occupation, location: a.location, bio: a.bio, mentor: a.mentor })) };
  },
  async join(b, req) {
    if (b.website) return { message: "Thank you." };
    const name = text(b.full_name, 120), email = text(b.email, 200).toLowerCase(), year = parseInt(b.graduation_year, 10);
    if (name.length < 2) throw new Bad("Please enter your full name.");
    if (!EMAIL_RE.test(email)) throw new Bad("Please enter a valid email address.");
    if (!(year >= 1960 && year <= new Date().getUTCFullYear() + 1)) throw new Bad("Enter the year you graduated.");
    if (b.consent_public !== true) throw new Bad("Please agree that your details can be shown on the alumni page.");
    if (!UUID.test(String(b.faculty_id || ""))) throw new Bad("Choose your faculty.");
    const n = await names(); if (!n.f[b.faculty_id]) throw new Bad("Choose your faculty.");
    let department_id = null;
    if (b.department_id) { const d = n.cat.find((x) => x.id === b.faculty_id).departments.find((x) => x.id === b.department_id); if (!d) throw new Bad("That department is not in the faculty you chose."); department_id = d.id; }
    let phone = null; if (b.phone) { if (!normalize(String(b.phone)).ok) throw new Bad("That phone number is not valid."); phone = text(String(b.phone), 30); }
    const ip = ipHash(req); if (await limited("alumni", ip)) throw new Bad("Too many sign-ups from this connection. Please try again later.", 429);
    if ((await srv(`alumni?email=eq.${enc(email)}&select=id&limit=1`)).length) throw new Bad("That email is already on the list. Thank you!", 409);
    await srv("alumni", { method: "POST", body: JSON.stringify({ full_name: name, graduation_year: year, faculty_id: b.faculty_id, department_id, occupation: text(b.occupation, 150) || null, location: text(b.location, 100) || null, bio: text(b.bio, 600) || null, email, phone, mentor: b.mentor === true, consent_public: true, ip_hash: ip }) });
    return { message: "Thank you! An administrator will review your details before they appear on the page." };
  },
  async mentor_request(b, req) {
    if (b.website) return { message: "Thank you." };
    if (!UUID.test(String(b.faculty_id || ""))) throw new Bad("Choose your faculty.");
    const n = await names(); if (!n.f[b.faculty_id]) throw new Bad("Choose your faculty.");
    const name = text(b.name, 120), message = text(b.message, 1000);
    if (name.length < 2) throw new Bad("Please enter your name.");
    if (message.length < 5) throw new Bad("Tell us a little about what you want a mentor for.");
    let phone = null, email = null;
    if (b.phone) { if (!normalize(String(b.phone)).ok) throw new Bad("That phone number is not valid."); phone = text(String(b.phone), 30); }
    if (b.email) { email = text(b.email, 200).toLowerCase(); if (!EMAIL_RE.test(email)) throw new Bad("That email address is not valid."); }
    if (!phone && !email) throw new Bad("Please give a phone number or email so we can reach you.");
    const ip = ipHash(req); if (await limited("mentor_requests", ip)) throw new Bad("Too many requests from this connection. Please try again later.", 429);
    await srv("mentor_requests", { method: "POST", body: JSON.stringify({ faculty_id: b.faculty_id, name, phone, email, message, ip_hash: ip }) });
    return { message: "Your request was received. An administrator will connect you with a mentor and contact you." };
  },
};

const adm = {
  async admin_list(b) {
    const st = ["pending", "approved", "rejected"].includes(b.status) ? `&status=eq.${b.status}` : "";
    const [rows, n] = await Promise.all([srv(`alumni?select=id,created_at,full_name,graduation_year,faculty_id,department_id,occupation,location,bio,email,phone,mentor,status${st}&order=created_at.desc&limit=500`), names()]);
    return { alumni: rows.map((a) => ({ ...a, faculty: n.f[a.faculty_id] || "", department: n.d[a.department_id] || "" })) };
  },
  async admin_set(b) {
    if (!UUID.test(String(b.id || ""))) throw new Bad("Unknown record.");
    const patch = {}; if (b.status !== undefined) { if (!["pending", "approved", "rejected"].includes(b.status)) throw new Bad("Unknown status."); patch.status = b.status; }
    if (b.mentor !== undefined) patch.mentor = b.mentor === true;
    if (!Object.keys(patch).length) throw new Bad("Nothing to change.");
    const before = (await srv(`alumni?id=eq.${b.id}&select=full_name,email,status,mentor&limit=1`))[0];
    if (!before) throw new Bad("That record was not found.", 404);
    await srv(`alumni?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    // Tell the person once, when they are first approved. They gave this address to join the list.
    if (patch.status === "approved" && before.status !== "approved") {
      await mailTo(before.email, "You are on the DCF UNN alumni page", `Hello ${before.full_name},\n\nThank you for joining the Dunamis Campus Fellowship alumni list. Your details are now on the alumni page: ${SITE}/alumni\n\n${patch.mentor ?? before.mentor ? "You said you are willing to mentor students. When a student in your faculty asks, an administrator will email you their request and contact details.\n\n" : ""}Your email and phone are never shown publicly.\n\nGod bless you.\nDCF UNN`);
    }
    return { ok: true };
  },
  async admin_delete(b) { if (!UUID.test(String(b.id || ""))) throw new Bad("Unknown record."); await srv(`alumni?id=eq.${b.id}`, { method: "DELETE" }); return { ok: true }; },
  async req_list(b) {
    const st = ["new", "matched", "closed"].includes(b.status) ? `&status=eq.${b.status}` : "";
    const [rows, n] = await Promise.all([srv(`mentor_requests?select=*${st}&order=created_at.desc&limit=300`), names()]);
    const mentors = await srv("alumni?status=eq.approved&mentor=eq.true&select=id,full_name,faculty_id,email,phone,occupation,graduation_year&limit=500");
    return { requests: rows.map((r) => ({ id: r.id, created_at: r.created_at, faculty: n.f[r.faculty_id] || "", name: r.name, phone: r.phone, email: r.email, message: r.message, status: r.status, note: r.note, handled_by: r.handled_by, mentors: mentors.filter((m) => m.faculty_id === r.faculty_id).map(({ faculty_id, ...m }) => m) })) };
  },
  // Introduces a student to a mentor by email. The mentor receives the student's request and contact; the student is told who will reach out.
  async req_introduce(b, req, me) {
    if (!UUID.test(String(b.id || "")) || !UUID.test(String(b.alumni_id || ""))) throw new Bad("Unknown request or mentor.");
    const r = (await srv(`mentor_requests?id=eq.${b.id}&select=*&limit=1`))[0];
    const m = (await srv(`alumni?id=eq.${b.alumni_id}&select=*&limit=1`))[0];
    if (!r) throw new Bad("That request was not found.", 404);
    if (!m || m.status !== "approved" || !m.mentor || m.faculty_id !== r.faculty_id) throw new Bad("Choose an approved mentor from the same faculty.");
    const n = await names();
    const mentorOk = await mailTo(m.email, "A student would like your mentorship", `Hello ${m.full_name},\n\nA student in the Faculty of ${n.f[r.faculty_id]} asked the Dunamis Campus Fellowship for a mentor, and we thought of you.\n\nName: ${r.name}\nPhone: ${r.phone || "not given"}\nEmail: ${r.email || "not given"}\n\nWhat they asked:\n${r.message}\n\nPlease reach out to them when you can. If you cannot mentor right now, just reply to this email and we will find someone else.\n\nThank you for serving.\nDCF UNN`);
    const studentOk = r.email ? await mailTo(r.email, "Your mentor request", `Hello ${r.name},\n\nThank you for asking for a mentor. We have shared your request and contact details with ${m.full_name}${m.occupation ? " (" + m.occupation + ")" : ""}, a graduate of the Faculty of ${n.f[r.faculty_id]}. They will reach out to you.\n\nIf you do not hear back within two weeks, reply to this email.\n\nGod bless you.\nDCF UNN`) : false;
    if (!mentorOk) throw new Bad("The email to the mentor could not be sent, so nothing was recorded. Check the email setup, or contact them yourself.", 502);
    await srv(`mentor_requests?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify({ status: "matched", handled_by: me.email, note: [r.note, `Introduced to ${m.full_name} on ${new Date().toISOString().slice(0, 10)}`].filter(Boolean).join("\n").slice(0, 1000) }) });
    return { ok: true, mentor_emailed: true, student_emailed: studentOk };
  },
  async req_set(b, req, me) {
    if (!UUID.test(String(b.id || ""))) throw new Bad("Unknown request.");
    const patch = { handled_by: me.email };
    if (b.status !== undefined) { if (!["new", "matched", "closed"].includes(b.status)) throw new Bad("Unknown status."); patch.status = b.status; }
    if (b.note !== undefined) patch.note = text(b.note, 1000) || null;
    await srv(`mentor_requests?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify(patch) }); return { ok: true };
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const b = req.body && typeof req.body === "object" ? req.body : {}, name = String(b.action || "");
  const has = (o) => Object.prototype.hasOwnProperty.call(o, name);
  if (!has(pub) && !has(adm)) return res.status(400).json({ error: "Unknown action." });
  if (!hasSrv()) return res.status(503).json({ error: "Server setup is incomplete." });
  try {
    if (has(pub)) return res.status(200).json(await pub[name](b, req));
    const me = await adminAuth(req, res); if (!me) return;
    if (!["super_admin", "content_admin"].includes(me.role)) return res.status(403).json({ error: "Your role cannot manage alumni." });
    return res.status(200).json(await adm[name](b, req, me));
  } catch (e) {
    if (e instanceof Bad) return res.status(e.code).json({ error: e.message });
    console.error("alumni failed:", e); res.status(500).json({ error: "Server error. Please try again." });
  }
};
