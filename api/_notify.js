// Sends one message by email, SMS and/or WhatsApp. Every send passes, in order:
//   consent -> valid address -> opt-out list -> test mode -> provider.
// A channel with missing provider settings is skipped, so channels can be switched on one at a time.
const { srv, hasSrv, SB } = require("./_comms/db");
const { normalize } = require("./_comms/phone");
const { testMode, allowedInTest } = require("./_comms/settings");
const { inWindow } = require("./_comms/webhook-store");
const { render } = require("./_comms/email-template");
const token = require("./_comms/token");
const gmail = require("./_comms/providers/gmail"), termii = require("./_comms/providers/termii"), whatsapp = require("./_comms/providers/whatsapp");

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "friend";
const fill = (t, m) => String(t).replace(/\{name\}/gi, firstName(m.full_name));
const oneLine = (t) => String(t).replace(/\s+/g, " ").trim();

// Who may be messaged, and on which channel. Fails closed: if consent cannot be checked, nothing is sent.
//  - member.consent       : explicit consent just given on the join form ({email,sms,whatsapp} booleans)
//  - member.id            : the member's saved per-channel consent and global opt-out
//  - member.attendance_id : a visitor, who agreed to SMS / WhatsApp on the check-in page
const consentFor = async (m) => {
  if (m.consent) return { map: m.consent };
  if (m.id) {
    if (!hasSrv()) return { deny: "consent check unavailable" };
    const r = await srv(`member_preferences?member_id=eq.${m.id}&select=whatsapp_opt_in,sms_opt_in,email_opt_in,opted_out&limit=1`);
    if (!r.length) return { deny: "no consent record" };
    const p = r[0];
    if (p.opted_out) return { deny: "member opted out" };
    return { map: { whatsapp: p.whatsapp_opt_in, sms: p.sms_opt_in, email: p.email_opt_in } };
  }
  if (m.attendance_id) return { map: { sms: true, whatsapp: true, email: m.email_ok === true } };
  return { deny: "no consent record" };
};
const addrFor = (ch, m) => {
  if (ch === "email") { const e = String(m.email || "").trim().toLowerCase(); return EMAIL_RE.test(e) ? { ok: true, address: e } : { ok: false, reason: "invalid email address" }; }
  const p = normalize(m.phone);
  return p.ok ? { ok: true, address: p.digits } : { ok: false, reason: "invalid phone number" };
};
const suppressed = async (ch, a) => !a ? false : (await srv(`contact_suppressions?address=eq.${encodeURIComponent(a)}&channel=in.(${ch},all)&select=id&limit=1`)).length > 0;

const siteUrl = () => (process.env.SITE_URL || "https://dcf-unn-site.vercel.app").replace(/\/$/, "");
const dispatch = async (ch, member, address, text, subject) => {
  if (ch === "sms") {
    if (!termii.configured()) return { skipped: "sms not configured" };
    return { provider: termii.name, ...(await termii.send({ to: address, text: oneLine(text) })) };
  }
  if (ch === "whatsapp") {
    if (!whatsapp.configured()) return { skipped: "whatsapp not configured" };
    let open = false;
    try { open = await inWindow(address); } catch { open = false; }              // unsure -> use the approved template
    if (open) return { provider: whatsapp.name, ...(await whatsapp.sendText({ to: address, text })) };
    if (!process.env.WHATSAPP_TEMPLATE) return { skipped: "no approved WhatsApp template set" };
    return { provider: whatsapp.name, ...(await whatsapp.sendTemplate({ to: address, template: process.env.WHATSAPP_TEMPLATE, variables: [text] })) };
  }
  if (ch === "email") {
    if (!gmail.configured()) return { skipped: "email not configured" };
    const t = member.id ? token.sign({ m: member.id, c: "email" }) : member.attendance_id ? token.sign({ a: member.attendance_id, c: "email" }) : null;
    const unsubscribeUrl = t ? `${siteUrl()}/api/comms/unsubscribe?t=${t}` : null;
    const subj = subject || "A message from DCF UNN", body = render({ subject: subj, text, unsubscribeUrl });
    const headers = unsubscribeUrl ? { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
    return { provider: gmail.name, ...(await gmail.send({ to: address, subject: subj, text: body.text, html: body.html, headers })) };
  }
  return { skipped: "unknown channel" };
};

// member: {id?, attendance_id?, full_name, email, phone, consent?}
// Returns {email:"sent|failed|skipped", sms:..., whatsapp:...}. Never throws. out.reasons holds the why.
const sendAll = async ({ member, channels, subject, message, kind, queueId, attempt }) => {
  const text = fill(message, member), out = {}, reasons = {}, retry = {};
  let c; try { c = await consentFor(member); } catch (e) { console.error("consent lookup failed:", e.message); c = { deny: "consent check failed" }; }
  const tm = await testMode();
  await Promise.all(channels.map(async (ch) => {
    let st = "sent", detail = null, res = null;
    try {
      let why = c.deny || (c.map && c.map[ch] ? null : "no consent for " + ch);
      const a = addrFor(ch, member);
      if (!why && !a.ok) why = a.reason;
      if (!why) { try { if (await suppressed(ch, a.address)) why = "contact opted out"; } catch { why = "opt-out check failed"; } }
      if (!why && !allowedInTest(tm, ch, a.address)) why = "test mode: recipient not authorised";
      if (why) { st = "skipped"; detail = why; }
      else { res = await dispatch(ch, member, a.address, text, subject); if (res.skipped) { st = "skipped"; detail = res.skipped; } }
    } catch (e) { st = "failed"; detail = String(e.message).slice(0, 300); retry[ch] = e && e.retryable === true; console.error(ch, "failed:", detail); }
    out[ch] = st; reasons[ch] = detail;
    if (st !== "skipped" && hasSrv()) {
      try {
        await srv("message_log", { method: "POST", body: JSON.stringify({
          member_id: member.id || null, attendance_id: member.attendance_id || null, recipient_name: member.full_name || null,
          recipient: ch === "email" ? member.email : member.phone, channel: ch, kind, category: kind, status: st, detail,
          provider: res && res.provider || null, provider_message_id: res && res.id || null, queue_id: queueId || null, retry_count: attempt ? Math.max(0, attempt - 1) : 0, sent_at: st === "sent" ? new Date().toISOString() : null }) });
      } catch (e) { console.error("log failed", e.message); }
    }
  }));
  Object.defineProperty(out, "reasons", { value: reasons, enumerable: false });
  Object.defineProperty(out, "retryable", { value: retry, enumerable: false });
  return out;
};
module.exports = { srv, sendAll, SB: SB() };
