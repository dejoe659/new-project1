// Everything webhooks need from the database: store each event once, apply delivery statuses
// without ever moving a message backwards, honour STOP, and know the WhatsApp 24-hour window.
const { srv } = require("./db");
const { normalize } = require("./phone");
const enc = encodeURIComponent;

// Providers retry. The unique (provider, dedupe_key) makes a repeat a harmless no-op.
// Returns the new row's id, or null when the event was already stored.
async function storeEvent({ provider, dedupeKey, eventType, messageId, payload, signatureValid }) {
  const rows = await srv("provider_webhooks?on_conflict=provider,dedupe_key", {
    method: "POST", json: true, headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ provider, dedupe_key: dedupeKey, event_type: eventType, provider_message_id: messageId || null, payload, signature_valid: signatureValid }),
  });
  return rows && rows.length ? rows[0].id : null;
}
const markProcessed = (id, error) => srv(`provider_webhooks?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ processed_at: new Date().toISOString(), error: error || null }) });

// status: "sent" | "delivered" | "failed". raw: the provider's own word (e.g. "read", "DELIVRD").
// delivered is final: a late "sent" or "failed" never overwrites it. Returns "applied" | "ignored" | "not_found".
async function applyDelivery(provider, messageId, status, raw, detail) {
  const now = new Date().toISOString(), where = `provider=eq.${provider}&provider_message_id=eq.${enc(messageId)}`;
  const patch = async (extra, body) => (await srv(`message_log?${where}${extra}`, { method: "PATCH", json: true, headers: { Prefer: "return=representation" }, body: JSON.stringify(body) })) || [];
  let rows = [];
  if (status === "delivered") {
    rows = await patch("&status=neq.delivered", { status: "delivered", delivered_at: now, delivery_status: raw, delivery_updated_at: now });
    if (!rows.length && raw === "read") rows = await patch("&status=eq.delivered", { delivery_status: "read", delivery_updated_at: now });
  } else if (status === "failed") {
    rows = await patch("&status=eq.sent", { status: "failed", detail: String(detail || "provider reported a failure").slice(0, 300), delivery_status: raw, delivery_updated_at: now });
  } else {
    rows = await patch("&status=eq.sent", { delivery_status: raw, delivery_updated_at: now });
  }
  if (rows.length) return "applied";
  const exists = await srv(`message_log?${where}&select=id&limit=1`);
  return exists.length ? "ignored" : "not_found";
}

// A status can arrive before we finished logging the send. Those events stay unprocessed and are retried here.
async function processPending(limit = 20) {
  const older = enc(new Date(Date.now() - 30000).toISOString());
  const rows = await srv(`provider_webhooks?processed_at=is.null&event_type=eq.status&received_at=lt.${older}&order=received_at.asc&limit=${limit}&select=id,provider,provider_message_id,payload,received_at`);
  let done = 0;
  for (const w of rows) {
    const p = w.payload || {}, res = await applyDelivery(w.provider, w.provider_message_id, p.mapped_status, p.raw_status, p.detail);
    if (res !== "not_found") { await markProcessed(w.id); done++; }
    else if (Date.now() - new Date(w.received_at) > 2 * 864e5) { await markProcessed(w.id, "no matching message"); done++; }
  }
  return done;
}

// WhatsApp lets us send free text only within 24 hours of the person's last message to us.
async function inWindow(digits) {
  const since = enc(new Date(Date.now() - 24 * 3600e3).toISOString());
  const r = await srv(`provider_webhooks?provider=eq.whatsapp_cloud&event_type=eq.message&payload->>from=eq.${enc(digits)}&received_at=gte.${since}&select=id&limit=1`);
  return r.length > 0;
}

const suppress = (channel, address, source, reason) => srv("contact_suppressions?on_conflict=channel,address", {
  method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ channel, address, source, reason }) });

// Turn a channel off for every member whose phone matches (phones are stored in many formats, so match in code).
async function optOutPhone(digits, channel) {
  const members = (await srv("members?select=id,phone&limit=5000")).filter((m) => { const p = normalize(m.phone); return p.ok && p.digits === digits; });
  if (!members.length) return 0;
  await srv(`member_preferences?member_id=in.(${members.map((m) => m.id).join(",")})`, { method: "PATCH", body: JSON.stringify({ [channel + "_opt_in"]: false, consent_source: "member_request" }) });
  return members.length;
}
const STOP_WORDS = /^\s*(stop|unsubscribe|cancel|end|quit|stop all|opt ?out)\s*[.!]?\s*$/i;
module.exports = { storeEvent, markProcessed, applyDelivery, processPending, inWindow, suppress, optOutPhone, STOP_WORDS };
