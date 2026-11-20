// Server-side database access with the service-role key. Never imported by browser code.
const SB = () => process.env.SUPABASE_URL || "https://takdaiqvaxancqrqwwhy.supabase.co";
// Accepts either name: the older SUPABASE_SERVICE_ROLE_KEY or the newer SUPABASE_SECRET_KEY.
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
// The newer "sb_secret_..." keys are not JWTs, so they go in the apikey header only.
const authHeaders = (k) => (k.startsWith("sb_secret_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` });
const hasSrv = () => !!key();
// opt.json = true -> return the JSON body even for POST / PATCH (use with Prefer: return=representation)
async function srv(path, opt = {}) {
  const k = key();
  if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is not set");
  const { json, ...o } = opt;
  const r = await fetch(`${SB()}/rest/v1/${path}`, { ...o, headers: { ...authHeaders(k), "Content-Type": "application/json", Prefer: "return=minimal", ...o.headers } });
  if (!r.ok) throw new Error("db " + r.status);
  if (r.status === 204 || (!json && o.method === "POST")) return null;
  return r.json();
}
module.exports = { SB, srv, hasSrv };
