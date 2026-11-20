// Test helpers: mocked providers and a database stand-in. Nothing here can send a real message.
const path = require("path");
const KEYS = ["SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY","TERMII_API_KEY","TERMII_SENDER_ID","WHATSAPP_TOKEN","WHATSAPP_PHONE_ID","WHATSAPP_TEMPLATE",
  "GMAIL_USER","GMAIL_APP_PASSWORD","AUTO_WELCOME","CRON_SECRET","AUTO_FOLLOWUP","AUTO_VISITOR_THANKS","TERMII_BASE_URL","TERMII_CHANNEL","TERMII_WEBHOOK_SECRET","TERMII_WEBHOOK_TOKEN","WHATSAPP_VERIFY_TOKEN","WHATSAPP_APP_SECRET","WHATSAPP_LANG","UNSUBSCRIBE_SECRET","SITE_URL"];
function load(env = {}) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  for (const f of Object.keys(require.cache)) if (f.includes(path.join("api", ""))) delete require.cache[f];
  return (name) => require(path.join(__dirname, "..", "api", name));
}
const PROVIDERS = { TERMII_API_KEY: "k", TERMII_SENDER_ID: "DCF", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "1", WHATSAPP_TEMPLATE: "tpl", SUPABASE_SERVICE_ROLE_KEY: "srv" };
function mockFetch(state = {}) {
  const calls = [];
  global.fetch = async (url, opt = {}) => {
    const body = opt.body && typeof opt.body === "string" ? JSON.parse(opt.body) : undefined;
    calls.push({ url, method: opt.method || "GET", body });
    const ok = (j, s = 200) => ({ ok: s < 300, status: s, json: async () => j });
    if (state.dbDown && url.includes("/rest/v1/")) return ok({}, 500);
    if (url.includes("/auth/v1/user")) return ok({ id: "u" });
    if (url.includes("/rest/v1/admins")) return ok([{ role: "super_admin" }]);
    if (url.includes("communication_settings?")) return ok(state.noTestRow ? [] : [{ value: { enabled: !!state.testMode, recipients: state.testRecipients || [] } }]);
    if (url.includes("member_preferences?")) return ok(state.prefs ? [state.prefs] : []);
    if (url.includes("contact_suppressions?")) {
      const ch = /channel=in\.\(([a-z]+),all\)/.exec(url)[1], s = state.suppressed || [];
      return ok(s.includes(ch) || s.includes("all") ? [{ id: 1 }] : []);
    }
    if (url.includes("members?id=in")) return ok([{ id: "11111111-1111-1111-1111-111111111111", full_name: "Chika Okafor", email: "c@x.com", phone: "08033334444", consent_comms: true }]);
    if (url.includes("termii")) return ok({ message_id: "T1", message: "Successfully Sent" });
    if (url.includes("graph.facebook")) return ok({ messages: [{ id: "W1" }] });
    if (url.includes("/rest/v1/message_log")) return ok(null, 201);
    if (url.includes("/rest/v1/members") && opt.method === "POST") return ok(null, 201);
    return ok([]);
  };
  calls.sent = (what) => calls.filter(c => what === "sms" ? c.url.includes("termii") : what === "whatsapp" ? c.url.includes("graph.facebook") : false).length;
  return calls;
}
const res = () => { const r = { code: 0, body: null, headers: {}, headersSent: false, status(c) { r.code = c; return r; }, json(b) { r.body = b; r.headersSent = true; return r; }, send(b) { r.body = b; r.headersSent = true; return r; }, setHeader(k, v) { r.headers[k] = v; }, end() { r.headersSent = true; return r; } }; return r; };
module.exports = { load, mockFetch, res, PROVIDERS };
