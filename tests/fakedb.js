// A small in-memory stand-in for Supabase's REST API, plus mocked SMS / WhatsApp providers.
// It understands exactly the filters the code uses, so webhook ordering and duplicate handling are tested for real.
const UNIQUE = { provider_webhooks: ["provider", "dedupe_key"], contact_suppressions: ["channel", "address"], message_log: [] };
function create(seed = {}) {
  const t = { provider_webhooks: [], message_log: [], contact_suppressions: [], member_preferences: [], members: [], communication_settings: [], ...seed };
  const calls = []; let n = 0;
  const getPath = (row, key) => key.includes("->>") ? key.split("->>").reduce((a, k, i) => i ? (a == null ? a : a[k]) : row[k], null) : row[key];
  const test = (row, key, cond) => {
    const [op, ...rest] = cond.split("."), val = rest.join("."), v = getPath(row, key);
    switch (op) {
      case "eq": return String(v) === val;
      case "neq": return String(v) !== val;
      case "is": return val === "null" ? v == null : v != null;
      case "in": return val.replace(/^\(|\)$/g, "").split(",").includes(String(v));
      case "lt": return v != null && String(v) < val;
      case "gte": return v != null && String(v) >= val;
      default: return true;
    }
  };
  const filter = (rows, qs) => { for (const [k, c] of qs.entries()) { if (["select", "order", "limit", "on_conflict"].includes(k)) continue; rows = rows.filter((r) => test(r, k, c)); } return rows; };
  const handle = async (url, opt = {}) => {
    const u = new URL(url), table = u.pathname.split("/rest/v1/")[1], prefer = (opt.headers && opt.headers.Prefer) || "", method = opt.method || "GET";
    const rows = (t[table] = t[table] || []), body = opt.body ? JSON.parse(opt.body) : null, res = (j, s = 200) => ({ ok: s < 300, status: s, json: async () => j });
    if (method === "GET") { let r = filter(rows, u.searchParams); const l = u.searchParams.get("limit"); if (l) r = r.slice(0, +l); return res(r.map((x) => ({ ...x }))); }   // copies, like a real database
    if (method === "POST") {
      const keys = UNIQUE[table] || [];
      if (keys.length && rows.some((r) => keys.every((k) => r[k] === body[k]))) { if (prefer.includes("ignore-duplicates")) return res(prefer.includes("representation") ? [] : null, prefer.includes("representation") ? 200 : 201); return res({ message: "duplicate" }, 409); }
      if (table === "message_log" && body.provider_message_id && rows.some((r) => r.provider === body.provider && r.provider_message_id === body.provider_message_id)) return res({ message: "duplicate" }, 409);
      const row = { id: table === "campaigns" ? require("crypto").randomUUID() : "id" + ++n, received_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body }; rows.push(row);
      return prefer.includes("representation") ? res([row], 201) : res(null, 201);
    }
    if (method === "PATCH") { const hit = filter(rows, u.searchParams); hit.forEach((r) => Object.assign(r, body, { updated_at: new Date(Date.now() + ++n).toISOString() })); return prefer.includes("representation") ? res(hit) : res(null, 204); }
    return res({}, 405);
  };
  const providers = { sms: [], whatsapp: [] };
  const install = (opts = {}) => {
    global.fetch = async (url, opt = {}) => {
      calls.push({ url, method: opt.method || "GET", body: opt.body && typeof opt.body === "string" ? JSON.parse(opt.body) : undefined });
      if (url.includes("/rest/v1/")) return handle(url, opt);
      const ok = (j, s = 200) => ({ ok: s < 300, status: s, json: async () => j });
      if (url.includes("/api/sms/send")) { providers.sms.push(JSON.parse(opt.body)); return opts.sms ? opts.sms() : ok({ message_id: "TM" + providers.sms.length, message: "Successfully Sent" }); }
      if (url.includes("graph.facebook.com")) { providers.whatsapp.push(JSON.parse(opt.body)); return opts.whatsapp ? opts.whatsapp() : ok({ messages: [{ id: "wamid." + providers.whatsapp.length }] }); }
      return ok({});
    };
    return { calls, providers };
  };
  return { t, install, calls, providers };
}
module.exports = { create };
