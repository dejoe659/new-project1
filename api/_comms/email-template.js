// Branded HTML email with a plain-text alternative and an unsubscribe link.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function render({ subject, text, unsubscribeUrl }) {
  const body = esc(text).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`).join("");
  const foot = unsubscribeUrl
    ? `You are receiving this because you agreed to hear from Dunamis Campus Fellowship by email. <a href="${esc(unsubscribeUrl)}" style="color:#14451f">Unsubscribe</a>.`
    : "You are receiving this because you agreed to hear from Dunamis Campus Fellowship by email. Ask a leader to stop emails.";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6ee;font-family:Arial,Helvetica,sans-serif;color:#1d2a1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#14451f;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">Dunamis Campus Fellowship, UNN</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 16px;font-size:18px;color:#14451f">${esc(subject)}</h2>${body}</td></tr>
<tr><td style="padding:14px 24px;background:#f3f6ee;font-size:12px;color:#5b6b5e">${foot}<br>University of Nigeria, Nsukka</td></tr>
</table></td></tr></table></body></html>`;
  const plain = `${text}\n\n--\nDunamis Campus Fellowship, University of Nigeria, Nsukka\n` + (unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : "To stop emails, ask a leader.");
  return { html, text: plain };
}
module.exports = { render, esc };
