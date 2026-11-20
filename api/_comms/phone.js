// Phone numbers -> international digits (what Termii and WhatsApp want) and E.164 (+234...).
// Nigerian mobiles are accepted as 0803..., 803..., 234803..., +234803... or +2340803...
const ng = (n) => /^[789]\d{9}$/.test(n)
  ? { ok: true, digits: "234" + n, e164: "+234" + n, country: "NG", international: false }
  : { ok: false, reason: "not a valid Nigerian mobile number" };

function normalize(input) {
  const s = String(input == null ? "" : input).trim();
  if (!s) return { ok: false, reason: "empty" };
  const explicit = s.startsWith("+") || s.startsWith("00");
  let d = s.replace(/\D/g, "");
  if (s.startsWith("00")) d = d.slice(2);
  if (d.startsWith("2340") && d.length === 14) return ng(d.slice(4));    // +234 0803... (trunk zero kept by mistake)
  if (d.startsWith("234") && d.length === 13) return ng(d.slice(3));
  if (explicit) {
    if (d.length < 8 || d.length > 15) return { ok: false, reason: "invalid length" };
    return { ok: true, digits: d, e164: "+" + d, country: null, international: true };
  }
  if (d.startsWith("0") && d.length === 11) return ng(d.slice(1));
  if (d.length === 10) return ng(d);
  return { ok: false, reason: "unrecognised format (use 0803..., +234803... or +<country code>...)" };
}
const digits = (p) => { const r = normalize(p); return r.ok ? r.digits : null; };
module.exports = { normalize, digits };
