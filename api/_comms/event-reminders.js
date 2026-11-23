// Emails a reminder to people who registered for an event (and gave an email address and agreed), once, before it starts.
// Runs in the daily job. The unique key per registration means a reminder can never go out twice.
const { srv } = require("./db");
const queue = require("./queue");
const HOURS_AHEAD = 40;                                       // the daily job runs once a day, so look a little beyond 24 hours
const enc = encodeURIComponent;
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "friend";
const lagos = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

function wording(reg, ev) {
  return { subject: `Reminder: ${ev.title}`,
    text: `Hello ${firstName(reg.full_name)},\n\nThis is a reminder that you registered for ${ev.title}.\n\nWhen: ${lagos(ev.starts_at)}${ev.venue ? "\nWhere: " + ev.venue : ""}\n\nWe look forward to seeing you. If you can no longer come, just reply to this email.\n\nGod bless you.\nDunamis Campus Fellowship, UNN` };
}

async function run() {
  const now = new Date(), until = new Date(now.getTime() + HOURS_AHEAD * 36e5);
  const events = await srv(`events?starts_at=gte.${enc(now.toISOString())}&starts_at=lte.${enc(until.toISOString())}&select=id,title,venue,starts_at&limit=50`);
  if (!events.length) return { events: 0, queued: 0 };
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  const regs = await srv(`event_registrations?event_id=in.(${events.map((e) => e.id).join(",")})&email=not.is.null&select=id,event_id,full_name,email&limit=20000`);
  const { blocked } = await queue.loadContext();
  const rows = [];
  for (const r of regs) {
    const to = String(r.email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || blocked.has(`email|${to}`) || blocked.has(`all|${to}`)) continue;
    const ev = byId[r.event_id], w = wording(r, ev);
    rows.push({ idempotency_key: `eventrem:${ev.id}:${r.id}`, category: "meeting_reminder", mode: "automatic", channel: "email", provider: "gmail",
      recipient_name: r.full_name, recipient_address: to, subject: w.subject, body: w.text, status: "approved" });
  }
  for (let i = 0; i < rows.length; i += 200)
    await srv("message_queue?on_conflict=idempotency_key", { method: "POST", body: JSON.stringify(rows.slice(i, i + 200)), headers: { Prefer: "resolution=ignore-duplicates,return=minimal" } });
  return { events: events.length, queued: rows.length };
}
module.exports = { run, wording };
