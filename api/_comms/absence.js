// Automatic follow-up for people who missed a service. Runs from the daily job (queue-run).
// One personal message per absent member PER SERVICE, addressed by first name. A unique key per (service, member, channel)
// means the job can run any number of times and nobody is ever messaged twice about the same service.
// Only runs when the 'absent_followup' rule is switched to "automatic". Uses the same consent/opt-out checks as every message.
const { srv } = require("./db");
const queue = require("./queue");
const enc = encodeURIComponent;
const PROVIDER = { email: "gmail", sms: "termii", whatsapp: "whatsapp_cloud" };
const DAYS_BACK = 3;                                             // a service is followed up from the next day, for up to 3 days
const lagosDay = (d = new Date()) => new Date(d.getTime() + 36e5).toISOString().slice(0, 10);   // Nigeria is UTC+1, no daylight saving
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "friend";
const prettyDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function wording(name, session) {
  const what = session.kind ? `our ${session.kind}` : "our service";
  const text = `Hello ${firstName(name)},\n\nWe missed you at ${what} on ${prettyDate(session.session_date)}. We hope you are well and that nothing is wrong. You are important to us, and we would love to see you again.\n\nIf there is anything we can pray about or help with, just reply to this message.\n\nGod bless you.\nDunamis Campus Fellowship, UNN`;
  return { subject: `We missed you, ${firstName(name)}`, text, short: `Hello ${firstName(name)}, we missed you at ${what} on ${prettyDate(session.session_date)}. We pray all is well and would love to see you again. God bless you. - DCF UNN` };
}

async function run() {
  const rules = await srv("automation_rules?key=eq.absent_followup&select=mode,channels,config&limit=1");
  const rule = rules[0];
  if (!rule || rule.mode !== "automatic") return { enabled: false, queued: 0 };
  const channels = (rule.channels || []).filter((c) => PROVIDER[c]);
  if (!channels.length) return { enabled: true, queued: 0, note: "no channels chosen" };
  const today = lagosDay(), from = lagosDay(new Date(Date.now() - DAYS_BACK * 864e5));
  const sessions = (await srv(`sessions?session_date=gte.${from}&session_date=lt.${today}&select=id,kind,session_date&order=session_date.asc&limit=20`));
  if (!sessions.length) return { enabled: true, queued: 0, sessions: 0 };
  const [members, ctx] = await Promise.all([
    srv("members?review_status=eq.approved&select=id,full_name,email,phone,created_at&limit=5000"),
    queue.loadContext(),
  ]);
  const rows = [], skipped = {};
  for (const s of sessions) {
    const att = await srv(`attendance?session_id=eq.${s.id}&member_id=not.is.null&select=member_id&limit=5000`);
    const here = new Set(att.map((a) => a.member_id));
    for (const m of members) {
      if (here.has(m.id) || m.created_at.slice(0, 10) > s.session_date) continue;   // came, or had not joined yet
      const text = wording(m.full_name, s);
      for (const ch of channels) {
        const r = queue.reach(m, ch, ctx.pref[m.id], ctx.blocked);
        if (r.why) { skipped[r.why] = (skipped[r.why] || 0) + 1; continue; }
        rows.push({ idempotency_key: `absent:${s.id}:${m.id}:${ch}`, category: "absent_followup", mode: "automatic", channel: ch, provider: PROVIDER[ch],
          member_id: m.id, recipient_name: m.full_name, recipient_address: r.address,
          subject: ch === "email" ? text.subject : null, body: ch === "email" ? text.text : text.short, status: "approved" });
      }
    }
  }
  for (let i = 0; i < rows.length; i += 200)
    await srv("message_queue?on_conflict=idempotency_key", { method: "POST", body: JSON.stringify(rows.slice(i, i + 200)), headers: { Prefer: "resolution=ignore-duplicates,return=minimal" } });
  return { enabled: true, sessions: sessions.length, queued: rows.length, skipped };
}
module.exports = { run, wording, firstName };
