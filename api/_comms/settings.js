// Safe test mode. While it is ON, messages go ONLY to the recipients listed in
// communication_settings.test_mode. If the setting cannot be read, it counts as ON (fail closed).
const { srv, hasSrv } = require("./db");
const { normalize } = require("./phone");
let cache = null;
const _reset = () => { cache = null; };

async function testMode() {
  if (cache && Date.now() - cache.at < 30000) return cache.value;
  let value = { enabled: true, recipients: [], known: false };
  try {
    if (hasSrv()) {
      const r = await srv("communication_settings?key=eq.test_mode&select=value&limit=1");
      if (r.length && r[0].value && typeof r[0].value === "object") value = { enabled: r[0].value.enabled !== false, recipients: Array.isArray(r[0].value.recipients) ? r[0].value.recipients : [], known: true };
    }
  } catch (e) { console.error("test mode lookup failed:", e.message); }
  cache = { at: Date.now(), value };
  return value;
}
// address: international digits for sms / whatsapp, lower-case address for email.
function allowedInTest(tm, channel, address) {
  if (!tm.enabled) return true;
  const list = tm.recipients.map((x) => { const s = String(x).trim().toLowerCase(); if (s.includes("@")) return s; const p = normalize(s); return p.ok ? p.digits : s.replace(/\D/g, ""); });
  return list.includes(String(address).toLowerCase());
}
module.exports = { testMode, allowedInTest, _reset };
