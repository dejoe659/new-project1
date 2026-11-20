// Gmail SMTP adapter (Nodemailer). Gmail credentials never leave the server.
const nodemailer = require("nodemailer");
const { ProviderError } = require("../errors");
const E = () => process.env;
const configured = () => !!(E().GMAIL_USER && E().GMAIL_APP_PASSWORD);
let transport;
const getTransport = () => transport || (transport = nodemailer.createTransport({ service: "gmail", auth: { user: E().GMAIL_USER, pass: E().GMAIL_APP_PASSWORD } }));
const _setTransport = (t) => { transport = t; };   // tests only

async function send({ to, subject, text, html, headers }) {
  let info;
  try {
    info = await getTransport().sendMail({ from: `"Dunamis Campus Fellowship UNN" <${E().GMAIL_USER}>`, to, subject, text, html, headers });
  } catch (e) {
    const code = e.responseCode || 0;
    // 4xx SMTP codes and network errors are temporary; 5xx (bad address, auth failure) are not.
    const retryable = (code >= 400 && code < 500) || ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(e.code);
    throw new ProviderError("email error: " + (e.message || e.code), { retryable, code: e.code || code || null });
  }
  if (info.rejected && info.rejected.length) throw new ProviderError("email rejected: " + info.rejected.join(", "), { retryable: false });
  // SMTP acceptance means Gmail took the message. It is NOT proof of inbox delivery, so the status stays "sent".
  return { id: info.messageId || null, accepted: info.accepted || [] };
}
module.exports = { name: "gmail", configured, send, _setTransport };
