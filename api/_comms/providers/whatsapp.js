// Meta WhatsApp Cloud API adapter.
// Business-initiated messages MUST be approved templates. Free text is only allowed inside the
// 24-hour window after the person last messaged us (the caller checks that with inWindow()).
const { ProviderError } = require("../errors");
const E = () => process.env;
const configured = () => !!(E().WHATSAPP_TOKEN && E().WHATSAPP_PHONE_ID);
const url = () => `https://graph.facebook.com/${E().WHATSAPP_GRAPH_VERSION || "v25.0"}/${E().WHATSAPP_PHONE_ID}/messages`;
// Template variables may not contain new lines, tabs or runs of spaces.
const cleanVar = (v) => String(v).replace(/\s+/g, " ").trim().slice(0, 900);
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

async function post(body) {
  let r, j;
  try {
    r = await fetch(url(), { method: "POST", headers: { Authorization: "Bearer " + E().WHATSAPP_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", ...body }) });
    j = await r.json().catch(() => ({}));
  } catch (e) { throw new ProviderError("whatsapp network error: " + e.message, { retryable: true }); }
  if (r.ok && j.messages && j.messages[0]) return { id: j.messages[0].id };
  const err = j.error || {};
  const retryable = err.is_transient === true || RATE_LIMIT_CODES.has(err.code) || r.status >= 500 || r.status === 429;
  throw new ProviderError(err.message || "whatsapp " + r.status, { retryable, status: r.status, code: err.code || null });
}
const sendTemplate = ({ to, template, language, variables = [] }) => post({
  to, type: "template",
  template: { name: template, language: { code: language || E().WHATSAPP_LANG || "en" }, components: variables.length ? [{ type: "body", parameters: variables.map((v) => ({ type: "text", text: cleanVar(v) })) }] : [] },
});
const sendText = ({ to, text }) => post({ to, type: "text", text: { body: String(text).slice(0, 4000), preview_url: false } });
module.exports = { name: "whatsapp_cloud", configured, sendTemplate, sendText, cleanVar };
