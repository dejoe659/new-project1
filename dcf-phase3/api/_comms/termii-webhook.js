// Termii webhook (delivery reports and inbound SMS).
// The payload format is stored exactly as received, and parsed tolerantly, because it is not
// confirmed against Termii's own documentation yet. Check provider_webhooks after the first real report.
// Authenticity: HMAC-SHA512 in X-Termii-Signature over the raw body (secret TERMII_WEBHOOK_SECRET, else TERMII_API_KEY),
// OR a shared token in the URL (?token=...) matching TERMII_WEBHOOK_TOKEN. Neither valid = rejected.
const crypto = require("crypto");
const { readRaw } = require("./raw");
const store = require("./webhook-store");
const { normalize } = require("./phone");

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const DELIVERED = /^(delivered|delivrd|success|successful)$/, FAILED = /^(failed|undelivered|undeliv|rejected|expired|failure|dnd|blocked)$/, SENT = /^(sent|queued|submitted|accepted|buffered)$/;
const map = (s) => { s = String(s || "").toLowerCase().trim(); return DELIVERED.test(s) ? "delivered" : FAILED.test(s) ? "failed" : SENT.test(s) ? "sent" : null; };

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const secret = process.env.TERMII_WEBHOOK_SECRET || process.env.TERMII_API_KEY, tokenWant = process.env.TERMII_WEBHOOK_TOKEN;
  if (!secret && !tokenWant) { console.error("No Termii webhook secret or token set: webhook rejected"); return res.status(503).json({ error: "Not configured." }); }
  const raw = await readRaw(req);
  const sig = String(req.headers["x-termii-signature"] || "");
  const sigOk = !!(raw && secret && sig && same(sig, crypto.createHmac("sha512", secret).update(raw).digest("hex")));
  const tokenOk = !!(tokenWant && req.query && req.query.token && same(req.query.token, tokenWant));
  if (!sigOk && !tokenOk) { console.warn("termii webhook rejected: no valid signature or token"); return res.status(401).json({ error: "Unauthorized." }); }
  let body; try { body = JSON.parse(raw ? raw.toString("utf8") : JSON.stringify(req.body || {})); } catch { return res.status(400).json({ error: "Bad JSON." }); }

  const e = body.data && typeof body.data === "object" ? body.data : body;
  const id = e.message_id || e.messageId || e.id || null, rawStatus = e.status || e.sms_status || e.message_status || null;
  const mapped = map(rawStatus), text = e.message || e.sms || e.text || "", from = e.sender || e.from || e.phone_number || e.msisdn || null;
  const inbound = !id && from && text;
  const dedupe = id ? `status:${id}:${String(rawStatus).toLowerCase()}` : "evt:" + crypto.createHash("sha256").update(raw || JSON.stringify(body)).digest("hex").slice(0, 32);
  try {
    try { await store.processPending(); } catch (err) { console.error("pending retry failed:", err.message); }
    const payload = { ...body, mapped_status: mapped, raw_status: rawStatus, detail: e.error || e.reason || null };
    const rowId = await store.storeEvent({ provider: "termii", dedupeKey: dedupe, eventType: inbound ? "message" : "status", messageId: id, payload, signatureValid: sigOk });
    if (rowId) {
      let error = null, keep = false;
      try {
        if (inbound) {
          const p = normalize(from);
          if (store.STOP_WORDS.test(String(text)) && p.ok) { await store.suppress("sms", p.digits, "stop_reply", "Replied STOP by SMS"); await store.optOutPhone(p.digits, "sms"); }
        } else if (id && mapped) keep = (await store.applyDelivery("termii", String(id), mapped, String(rawStatus), payload.detail)) === "not_found";
        else error = "unrecognised event";
      } catch (err) { error = err.message; keep = true; console.error("termii event failed:", err.message); }
      if (!keep) await store.markProcessed(rowId, error);
    }
    return res.status(200).json({ ok: true });
  } catch (err) { console.error("termii webhook storage failed:", err.message); return res.status(500).json({ error: "Try again." }); }
};
