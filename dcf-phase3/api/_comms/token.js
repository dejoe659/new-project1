// Signed, tamper-proof tokens for unsubscribe links. No expiry: an unsubscribe link must keep working.
const crypto = require("crypto");
const b64 = (b) => Buffer.from(b).toString("base64url");
const secret = () => process.env.UNSUBSCRIBE_SECRET;
const mac = (data) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");
function sign(payload) {
  if (!secret()) return null;
  const body = b64(JSON.stringify(payload));
  return body + "." + mac(body);
}
function verify(token) {
  if (!secret() || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
}
module.exports = { sign, verify };
