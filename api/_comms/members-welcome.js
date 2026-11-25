// Automatic welcome email for new members. One per member, ever (unique key), only to people who ticked email consent
// and have not opted out. Runs right after registration and again in the daily job as a safety net.
// Only runs when the 'welcome' rule is "automatic" and includes the email channel (Admin > Messages > Automations).
const { srv } = require("./db");
const queue = require("./queue");
const { firstName } = require("./absence");
const SITE = "https://dcf-unn-site.vercel.app";
const enc = encodeURIComponent;

function wording(name) {
  const n = firstName(name);
  return { subject: `Welcome to Dunamis Campus Fellowship, ${n}!`,
    text: `Hello ${n},\n\nWelcome to Dunamis Campus Fellowship, UNN! We are so glad you registered. A leader will review your details and be in touch.\n\nWhen we meet:\n- Tuesday 5:30 PM, Celebration Service\n- Thursday 5:00 PM, Bible Study\n- Friday 5:00 PM, Friday Prayer (Lawn Tennis)\n- Saturday 3:00 PM, Evangelism (Lawn Tennis)\n\nA few things made for you:\n- New to UNN? ${SITE}/freshers\n- Struggling with a course? Your faculty coordinator can help: ${SITE}/academic\n- Upcoming programmes: ${SITE}/events\n- Need prayer or someone to talk to? It is private: ${SITE}/care\n\nYou are always welcome here.\n\nGod bless you.\nDunamis Campus Fellowship, UNN` };
}

async function run({ email = null } = {}) {
  const rule = (await srv("automation_rules?key=eq.welcome&select=mode,channels&limit=1"))[0];
  if (!rule || rule.mode !== "automatic" || !(rule.channels || []).includes("email")) return { enabled: false, queued: 0 };
  const since = enc(new Date(Date.now() - 3 * 864e5).toISOString());
  const scope = email ? `email=eq.${enc(String(email).trim().toLowerCase())}&created_at=gte.${since}` : `created_at=gte.${since}`;
  const members = (await srv(`members?${scope}&review_status=neq.rejected&email=not.is.null&select=id,full_name,email,phone&order=created_at.asc&limit=300`));
  if (!members.length) return { enabled: true, queued: 0 };
  const [ctx, old] = await Promise.all([queue.loadContext(), srv("message_log?kind=eq.welcome&select=member_id&limit=20000")]);
  const done = new Set(old.map((r) => r.member_id).filter(Boolean));            // welcomed earlier by the old one-off welcome
  const rows = [], skipped = {};
  for (const m of members) {
    if (done.has(m.id)) continue;
    const r = queue.reach(m, "email", ctx.pref[m.id], ctx.blocked);
    if (r.why) { skipped[r.why] = (skipped[r.why] || 0) + 1; continue; }
    const w = wording(m.full_name);
    rows.push({ idempotency_key: `member-welcome:${m.id}:email`, category: "welcome", mode: "automatic", channel: "email", provider: "gmail", member_id: m.id,
      recipient_name: m.full_name, recipient_address: r.address, subject: w.subject, body: w.text, status: "approved" });
  }
  if (rows.length) await srv("message_queue?on_conflict=idempotency_key", { method: "POST", body: JSON.stringify(rows), headers: { Prefer: "resolution=ignore-duplicates,return=minimal" } });
  return { enabled: true, queued: rows.length, skipped };
}
module.exports = { run, wording };
