// Automatic welcome email for first-time visitors who gave an email address and ticked the consent box on the check-in page.
// One welcome per email address, ever. Runs right after check-in (api/visitor-thanks) and again in the daily job as a safety net.
// Only runs when the 'visitor_followup' rule is "automatic" and includes the email channel.
const { srv } = require("./db");
const queue = require("./queue");
const { firstName } = require("./absence");
const enc = encodeURIComponent;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const prettyDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function wording(name, session) {
  const n = firstName(name), what = session && session.kind ? session.kind : "our service";
  return { subject: `Welcome to Dunamis Campus Fellowship, ${n}!`,
    text: `Hello ${n},\n\nWelcome to Dunamis Campus Fellowship! It was a joy to have you with us at ${what}${session ? " on " + prettyDate(session.session_date) : ""}. Thank you for coming.\n\nYou are always welcome here, and we would love to see you again. If you have a prayer request, a question, or want to know more about our meetings, just reply to this email.\n\nGod bless you.\nDunamis Campus Fellowship, UNN` };
}

async function welcome({ attendanceId = null } = {}) {
  const rule = (await srv("automation_rules?key=eq.visitor_followup&select=mode,channels&limit=1"))[0];
  if (!rule || rule.mode !== "automatic" || !(rule.channels || []).includes("email")) return { enabled: false, queued: 0 };
  const since = enc(new Date(Date.now() - 3 * 864e5).toISOString());
  const scope = attendanceId ? `id=eq.${attendanceId}` : `created_at=gte.${since}`;
  const visits = await srv(`attendance?${scope}&visitor_email=not.is.null&visitor_email_consent=eq.true&member_id=is.null&select=id,session_id,visitor_name,visitor_email,created_at&order=created_at.asc&limit=200`);
  if (!visits.length) return { enabled: true, queued: 0 };
  const [{ blocked }, welcomed, sessions] = await Promise.all([
    queue.loadContext(),
    srv("message_queue?category=eq.visitor_welcome&select=recipient_address&limit=20000"),
    srv("sessions?select=id,kind,session_date&limit=500"),
  ]);
  const seen = new Set(welcomed.map((r) => String(r.recipient_address).toLowerCase())), sess = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const rows = [];
  for (const v of visits) {
    const to = String(v.visitor_email).trim().toLowerCase();
    if (!EMAIL_RE.test(to) || seen.has(to) || blocked.has(`email|${to}`) || blocked.has(`all|${to}`)) continue;
    seen.add(to);
    const w = wording(v.visitor_name, sess[v.session_id]);
    rows.push({ idempotency_key: `visitor:${v.id}:email`, category: "visitor_welcome", mode: "automatic", channel: "email", provider: "gmail", attendance_id: v.id,
      recipient_name: v.visitor_name, recipient_address: to, subject: w.subject, body: w.text, status: "approved" });
  }
  if (rows.length) await srv("message_queue?on_conflict=idempotency_key", { method: "POST", body: JSON.stringify(rows), headers: { Prefer: "resolution=ignore-duplicates,return=minimal" } });
  return { enabled: true, queued: rows.length };
}
module.exports = { welcome, wording };
