// Dashboard numbers for administrators. Counts only: never names, messages or request text.
// Care and academic counts are shown to super administrators only.
const { srv, hasSrv } = require("./db");
const { adminAuth } = require("./admin-auth");
const enc = encodeURIComponent;
const all = async (path) => { const out = []; for (let o = 0; o < 20000; o += 1000) { const rows = await srv(`${path}${path.includes("?") ? "&" : "?"}limit=1000&offset=${o}`); out.push(...rows); if (rows.length < 1000) break; } return out; };
const tally = (rows, f) => { const m = {}; for (const r of rows) { const k = f(r); if (k !== null && k !== undefined && k !== "") m[k] = (m[k] || 0) + 1; } return m; };
const WEEK = 6048e5;
// Monday 00:00 (Lagos is UTC+1, close enough for weekly bars) of the week containing d
const weekStart = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); const day = (x.getUTCDay() + 6) % 7; return new Date(x.getTime() - day * 864e5).toISOString().slice(0, 10); };

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!hasSrv()) return res.status(503).json({ error: "Server setup is incomplete." });
  try {
    const me = await adminAuth(req, res); if (!me) return;
    const now = Date.now(), d30 = enc(new Date(now - 30 * 864e5).toISOString()), d56 = enc(new Date(now - 8 * WEEK).toISOString());
    const [members, att, events, regs, testi, queue] = await Promise.all([
      all("members?select=review_status,department,level,created_at,profile_approved&order=created_at.asc"),
      all(`attendance?select=member_id,created_at&created_at=gte.${d56}&order=created_at.asc`),
      all("events?select=id,starts_at"),
      all("event_registrations?select=attended"),
      all("testimonies?select=status"),
      all(`message_queue?select=status,category&created_at=gte.${d30}`),
    ]);
    const weeks = []; for (let i = 7; i >= 0; i--) weeks.push(weekStart(now - i * WEEK));
    const wk = Object.fromEntries(weeks.map((w) => [w, { members: 0, visitors: 0 }]));
    for (const a of att) { const w = wk[weekStart(a.created_at)]; if (w) a.member_id ? w.members++ : w.visitors++; }
    const out = {
      role: me.role,
      members: { total: members.length, by_review: tally(members, (m) => m.review_status), public_profiles: members.filter((m) => m.profile_approved).length, joined_last_30_days: members.filter((m) => new Date(m.created_at).getTime() >= now - 30 * 864e5).length, by_department: tally(members, (m) => m.department), by_level: tally(members, (m) => m.level) },
      attendance: { weeks: weeks.map((w) => ({ week: w, members: wk[w].members, visitors: wk[w].visitors })) },
      events: { upcoming: events.filter((e) => e.starts_at && new Date(e.starts_at).getTime() > now).length, registrations: regs.length, attended: regs.filter((r) => r.attended).length },
      testimonies: tally(testi, (t) => t.status),
      messages_last_30_days: { by_status: tally(queue, (q) => q.status), by_category: tally(queue, (q) => q.category) },
    };
    if (me.role === "super_admin") {
      const [care, acad, facs] = await Promise.all([all("care_requests?select=kind,status"), all("academic_requests?select=faculty_id,status"), all("faculties?select=id,name")]);
      const fname = Object.fromEntries(facs.map((f) => [f.id, f.name]));
      out.care = { by_status: tally(care, (c) => c.status), by_kind: tally(care, (c) => c.kind) };
      out.academic = { by_status: tally(acad, (a) => a.status), by_faculty: tally(acad, (a) => fname[a.faculty_id] || "?") };
    }
    res.status(200).json(out);
  } catch (e) { console.error("stats failed:", e); res.status(500).json({ error: "Could not load the numbers." }); }
};
