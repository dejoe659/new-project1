// Termii SMS adapter. The API base URL comes from configuration (TERMII_BASE_URL), not from code.
const { ProviderError } = require("../errors");
const E = () => process.env;
const base = () => (E().TERMII_BASE_URL || "https://api.ng.termii.com").replace(/\/$/, "");
const configured = () => !!(E().TERMII_API_KEY && E().TERMII_SENDER_ID);

// to: international digits, e.g. 2348012345678. Returns { id }. Throws ProviderError.
async function send({ to, text }) {
  let r, j;
  try {
    r = await fetch(base() + "/api/sms/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, from: E().TERMII_SENDER_ID, sms: text, type: "plain", channel: E().TERMII_CHANNEL || "generic", api_key: E().TERMII_API_KEY }),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) { throw new ProviderError("termii network error: " + e.message, { retryable: true }); }
  if (r.ok && (j.message_id || /success/i.test(j.message || ""))) return { id: j.message_id || null };
  // 429 and 5xx may work later. Anything else (bad number, no credit, unapproved sender) will not.
  throw new ProviderError(j.message || "termii " + r.status, { retryable: r.status >= 500 || r.status === 429, status: r.status });
}
module.exports = { name: "termii", configured, send };
