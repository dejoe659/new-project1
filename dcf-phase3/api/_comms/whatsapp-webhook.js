// Meta WhatsApp Cloud API webhook: GET = one-time verification, POST = delivery statuses and inbound messages.
const crypto = require("crypto");
const { readRaw } = require("./raw");
const store = require("./webhook-store");
const whatsapp = require("./providers/whatsapp");
const { testMode, allowedInTest } = require("./settings");

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const MAP = { sent: "sent", delivered: "delivered", read: "delivered", failed: "failed" };

module.exports = async (req, res) => {
  if (req.method === "GET") {                                     // Meta calls this once when you save the webhook URL
    const q = req.query || {}, want = process.env.WHATSAPP_VERIFY_TOKEN;
    if (want && q["hub.mode"] === "subscribe" && same(q["hub.verify_token"] || "", want)) return res.status(200).send(String(q["hub.challenge"] || ""));
    return res.status(403).send("Forbidden");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) { console.error("WHATSAPP_APP_SECRET is not set: webhook rejected"); return res.status(503).json({ error: "Not configured." }); }
  const raw = await readRaw(req);
  const sig = String(req.headers["x-hub-signature-256"] || "").replace(/^sha256=/, "");
  const want = raw ? crypto.createHmac("sha256", secret).update(raw).digest("hex") : null;
  if (!raw || !sig || !same(sig, want)) {
    console.warn("whatsapp webhook rejected: signature mismatch (check WHATSAPP_APP_SECRET, and that the body was not re-encoded)");
    return res.status(401).json({ error: "Invalid signature." });
  }
  let body; try { body = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Bad JSON." }); }

  const events = [];
  for (const entry of body.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    for (const s of v.statuses || []) events.push({ type: "status", id: s.id, dedupe: `status:${s.id}:${s.status}`, data: s });
    for (const m of v.messages || []) events.push({ type: "message", id: m.id, dedupe: `message:${m.id}`, data: m });
  }
  try {
    try { await store.processPending(); } catch (e) { console.error("pending retry failed:", e.message); }
    for (const ev of events) {
      let payload = ev.data;
      if (ev.type === "status") {
        const err = (ev.data.errors || [])[0];
        payload = { ...ev.data, mapped_status: MAP[ev.data.status] || null, raw_status: ev.data.status, detail: err ? `${err.code || ""} ${err.title || err.message || ""}`.trim() : null };
      }
      const rowId = await store.storeEvent({ provider: "whatsapp_cloud", dedupeKey: ev.dedupe, eventType: ev.type, messageId: ev.id, payload, signatureValid: true });
      if (!rowId) continue;                                       // a retry of something already handled
      let error = null, keep = false;
      try {
        if (ev.type === "status") {
          if (!payload.mapped_status) error = "unknown status";
          else keep = (await store.applyDelivery("whatsapp_cloud", ev.id, payload.mapped_status, payload.raw_status, payload.detail)) === "not_found";
        } else if (ev.data.type === "text" && store.STOP_WORDS.test((ev.data.text && ev.data.text.body) || "")) {
          await handleStop(ev.data.from);
        }
      } catch (e) { error = e.message; console.error("webhook event failed:", e.message); keep = true; }
      if (!keep) await store.markProcessed(rowId, error);        // not_found stays pending and is retried (the log row may not exist yet)
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("whatsapp webhook storage failed:", e.message);
    return res.status(500).json({ error: "Try again." });         // Meta retries, and the dedupe key makes that safe
  }
};

async function handleStop(from) {
  await store.suppress("whatsapp", from, "stop_reply", "Replied STOP on WhatsApp");
  await store.optOutPhone(from, "whatsapp");
  // The person just messaged us, so we are inside the 24-hour window and may confirm in plain text.
  const tm = await testMode();
  if (whatsapp.configured() && allowedInTest(tm, "whatsapp", from)) {
    try { await whatsapp.sendText({ to: from, text: "You have been unsubscribed from Dunamis Campus Fellowship WhatsApp messages. God bless you." }); }
    catch (e) { console.error("stop confirmation failed:", e.message); }
  }
}
