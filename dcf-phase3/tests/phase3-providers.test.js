const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { Readable } = require("stream");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

const ENV = { ...PROVIDERS, GMAIL_USER: "dcf@gmail.com", GMAIL_APP_PASSWORD: "x", UNSUBSCRIBE_SECRET: "unsub-secret", SITE_URL: "https://dcf.test" };
const M = "11111111-1111-1111-1111-111111111111";
const memberRow = { id: M, full_name: "Chika Okafor", email: "chika@x.com", phone: "0803 333 4444" };
const prefs = (o = {}) => ({ member_id: M, whatsapp_opt_in: true, sms_opt_in: true, email_opt_in: true, opted_out: false, ...o });
const live = { key: "test_mode", value: { enabled: false, recipients: [] } };
const fakeTransport = () => { const sent = []; return { sent, sendMail: async (m) => { sent.push(m); return { messageId: "<m1@gmail>", accepted: [m.to], rejected: [] }; } }; };
const req = (body, headers = {}, extra = {}) => Object.assign(Readable.from([Buffer.from(body)]), { method: "POST", headers, query: {}, ...extra });
const wa = (secret, body) => ({ "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex") });
const status = (id, s, extra = {}) => JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id, status: s, recipient_id: "2348033334444", ...extra }] } }] }] });
const inbound = (from, text, id = "wamid.IN1") => JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from, id, type: "text", text: { body: text } }] } }] }] });

// ---------- phone numbers
test("phone: Nigerian formats all normalise to the same international number", () => {
  const { normalize } = require("../api/_comms/phone");
  for (const p of ["08033334444", "8033334444", "2348033334444", "+2348033334444", "+234 803 333 4444", "0803 333 4444", "+23408033334444", "002348033334444", "0803-333-4444"])
    assert.equal(normalize(p).digits, "2348033334444", p);
  assert.equal(normalize("08033334444").e164, "+2348033334444");
});
test("phone: bad Nigerian numbers are rejected, other countries need a +", () => {
  const { normalize } = require("../api/_comms/phone");
  for (const p of ["", "12345", "0803333444", "08133", "01234567890", "abc", "0603 333 4444"]) assert.equal(normalize(p).ok, false, p);
  const uk = normalize("+44 7911 123456"); assert.equal(uk.ok, true); assert.equal(uk.digits, "447911123456"); assert.equal(uk.international, true);
  assert.equal(normalize("447911123456").ok, false);     // no + and not Nigerian: refuse to guess
});

// ---------- email template and tokens
test("email template: escapes HTML, includes the unsubscribe link and a plain-text version", () => {
  const { render } = require("../api/_comms/email-template");
  const r = render({ subject: "Hi <b>", text: "Hello <script>alert(1)</script>\n\nSecond paragraph", unsubscribeUrl: "https://dcf.test/u?t=a&b=c" });
  assert.ok(!r.html.includes("<script>")); assert.ok(r.html.includes("&lt;script&gt;")); assert.ok(r.html.includes("Unsubscribe"));
  assert.ok(r.html.includes("t=a&amp;b=c")); assert.match(r.text, /Unsubscribe: https:\/\/dcf\.test\/u\?t=a&b=c/);
});
test("tokens: valid ones verify, tampered or secret-less ones do not", () => {
  process.env.UNSUBSCRIBE_SECRET = "s1"; delete require.cache[require.resolve("../api/_comms/token")];
  const tok = require("../api/_comms/token"), t = tok.sign({ m: "abc", c: "email" });
  assert.deepEqual(tok.verify(t), { m: "abc", c: "email" });
  const [body, sig] = t.split("."), forged = Buffer.from(JSON.stringify({ m: "other", c: "email" })).toString("base64url") + "." + sig;
  assert.equal(tok.verify(forged), null); assert.equal(tok.verify(body + ".x"), null); assert.equal(tok.verify("garbage"), null);
  process.env.UNSUBSCRIBE_SECRET = "s2"; assert.equal(tok.verify(t), null);        // rotated secret invalidates old links
  delete process.env.UNSUBSCRIBE_SECRET; assert.equal(tok.sign({ m: 1 }), null);
});

// ---------- adapters
test("termii: sends the documented fields and returns the provider message id", async () => {
  const api = load({ ...ENV, TERMII_CHANNEL: "dnd" }), db = create(), { providers } = db.install();
  const r = await api("_comms/providers/termii.js").send({ to: "2348033334444", text: "Hi" });
  assert.equal(r.id, "TM1");
  assert.deepEqual(providers.sms[0], { to: "2348033334444", from: "DCF", sms: "Hi", type: "plain", channel: "dnd", api_key: "k" });
});
test("termii: base URL comes from configuration", async () => {
  const api = load({ ...ENV, TERMII_BASE_URL: "https://v3.api.termii.com/" }), db = create(), { calls } = db.install();
  await api("_comms/providers/termii.js").send({ to: "2348033334444", text: "Hi" });
  assert.equal(calls[0].url, "https://v3.api.termii.com/api/sms/send");
});
test("termii: errors are classified as retryable or permanent", async () => {
  const api = load(ENV), mod = api("_comms/providers/termii.js"), db = create();
  const fail = (status, message) => db.install({ sms: () => ({ ok: false, status, json: async () => ({ message }) }) });
  fail(500, "boom"); await assert.rejects(mod.send({ to: "1", text: "x" }), (e) => e.retryable === true);
  fail(429, "slow down"); await assert.rejects(mod.send({ to: "1", text: "x" }), (e) => e.retryable === true);
  fail(400, "Insufficient balance"); await assert.rejects(mod.send({ to: "1", text: "x" }), (e) => e.retryable === false && /balance/i.test(e.message));
  global.fetch = async () => { throw new Error("ENOTFOUND"); }; await assert.rejects(mod.send({ to: "1", text: "x" }), (e) => e.retryable === true);
});
test("whatsapp: template payload carries sanitised variables and the configured language", async () => {
  const api = load({ ...ENV, WHATSAPP_LANG: "en_GB" }), db = create(), { providers } = db.install();
  const r = await api("_comms/providers/whatsapp.js").sendTemplate({ to: "2348033334444", template: "dcf_followup", variables: ["Hello Ada,\n\n   we   missed you", "Tue"] });
  assert.equal(r.id, "wamid.1");
  const b = providers.whatsapp[0];
  assert.equal(b.messaging_product, "whatsapp"); assert.equal(b.type, "template"); assert.equal(b.template.name, "dcf_followup"); assert.equal(b.template.language.code, "en_GB");
  assert.deepEqual(b.template.components[0].parameters, [{ type: "text", text: "Hello Ada, we missed you" }, { type: "text", text: "Tue" }]);
});
test("whatsapp: transient and rate-limit errors are retryable, rejected templates are not", async () => {
  const api = load(ENV), mod = api("_comms/providers/whatsapp.js"), db = create();
  const err = (status, error) => db.install({ whatsapp: () => ({ ok: false, status, json: async () => ({ error }) }) });
  err(400, { code: 131049, message: "ecosystem", is_transient: true }); await assert.rejects(mod.sendText({ to: "1", text: "x" }), (e) => e.retryable);
  err(400, { code: 130429, message: "rate limit" }); await assert.rejects(mod.sendText({ to: "1", text: "x" }), (e) => e.retryable);
  err(400, { code: 132001, message: "template does not exist" }); await assert.rejects(mod.sendText({ to: "1", text: "x" }), (e) => !e.retryable && e.code === 132001);
});
test("gmail: returns the message id, treats rejection as permanent, 4xx SMTP as retryable", async () => {
  const api = load(ENV), g = api("_comms/providers/gmail.js"), t = fakeTransport(); g._setTransport(t);
  assert.equal((await g.send({ to: "a@x.com", subject: "s", text: "t", html: "<p>t</p>" })).id, "<m1@gmail>");
  g._setTransport({ sendMail: async () => ({ messageId: "x", accepted: [], rejected: ["a@x.com"] }) });
  await assert.rejects(g.send({ to: "a@x.com", subject: "s", text: "t" }), (e) => e.retryable === false);
  g._setTransport({ sendMail: async () => { throw Object.assign(new Error("try later"), { responseCode: 421 }); } });
  await assert.rejects(g.send({ to: "a@x.com", subject: "s", text: "t" }), (e) => e.retryable === true);
  g._setTransport({ sendMail: async () => { throw Object.assign(new Error("bad auth"), { responseCode: 535 }); } });
  await assert.rejects(g.send({ to: "a@x.com", subject: "s", text: "t" }), (e) => e.retryable === false);
});

// ---------- the sender: test mode, validation, logging, WhatsApp window, email links
const sendAll = (api, over = {}) => api("_notify.js").sendAll({ member: memberRow, channels: ["sms", "whatsapp", "email"], subject: "Hello", message: "Hello {name}", kind: "manual", ...over });
test("test mode: with no setting row (or unreadable) NOTHING is sent", async () => {
  const api = load(ENV), db = create({ member_preferences: [prefs()] }), { providers } = db.install();
  const r = await sendAll(api);
  assert.deepEqual(r, { sms: "skipped", whatsapp: "skipped", email: "skipped" });
  assert.match(r.reasons.sms, /test mode/); assert.equal(providers.sms.length + providers.whatsapp.length, 0);
});
test("test mode: ON sends only to listed recipients (any phone format), others are skipped", async () => {
  const api = load(ENV), db = create({ member_preferences: [prefs()], communication_settings: [{ key: "test_mode", value: { enabled: true, recipients: ["+234 803 333 4444"] } }] }), { providers } = db.install();
  assert.equal((await sendAll(api, { channels: ["sms"] })).sms, "sent");
  const other = await sendAll(api, { channels: ["sms"], member: { ...memberRow, phone: "08099998888" } });
  assert.equal(other.sms, "skipped"); assert.equal(providers.sms.length, 1);
});
test("test mode: OFF allows sending, and the setting is cached briefly", async () => {
  const api = load(ENV), db = create({ member_preferences: [prefs()], communication_settings: [live] }), { calls, providers } = db.install();
  await sendAll(api, { channels: ["sms"] }); await sendAll(api, { channels: ["sms"] });
  assert.equal(providers.sms.length, 2); assert.equal(calls.filter((c) => c.url.includes("communication_settings")).length, 1);
});
test("sender: an invalid phone number is skipped with a clear reason, not sent", async () => {
  const api = load(ENV), db = create({ member_preferences: [prefs()], communication_settings: [live] }), { providers } = db.install();
  const r = await sendAll(api, { channels: ["sms", "whatsapp"], member: { ...memberRow, phone: "12345" } });
  assert.deepEqual(r, { sms: "skipped", whatsapp: "skipped" }); assert.equal(r.reasons.sms, "invalid phone number"); assert.equal(providers.sms.length, 0);
});
test("sender: the log records provider, provider message id, category and sent time", async () => {
  const api = load(ENV), db = create({ member_preferences: [prefs()], communication_settings: [live] }); db.install();
  await sendAll(api, { channels: ["sms"], kind: "birthday" });
  const row = db.t.message_log[0];
  assert.equal(row.provider, "termii"); assert.equal(row.provider_message_id, "TM1"); assert.equal(row.category, "birthday");
  assert.equal(row.status, "sent"); assert.ok(row.sent_at); assert.equal(row.recipient_name, "Chika Okafor");
});
test("sender: a failed provider call is logged as failed with the reason", async () => {
  const api = load(ENV), db = create({ member_preferences: [prefs()], communication_settings: [live] });
  db.install({ sms: () => ({ ok: false, status: 400, json: async () => ({ message: "Insufficient balance" }) }) });
  const r = await sendAll(api, { channels: ["sms"] });
  assert.equal(r.sms, "failed"); assert.equal(db.t.message_log[0].status, "failed"); assert.match(db.t.message_log[0].detail, /balance/i);
});
test("whatsapp: business-initiated uses the approved template; inside the 24h window it sends plain text", async () => {
  const api = load({ ...ENV, WHATSAPP_TEMPLATE: "dcf_followup" }), db = create({ member_preferences: [prefs()], communication_settings: [live] }), { providers } = db.install();
  await sendAll(api, { channels: ["whatsapp"] });
  assert.equal(providers.whatsapp[0].type, "template"); assert.deepEqual(providers.whatsapp[0].template.components[0].parameters, [{ type: "text", text: "Hello Chika" }]);
  db.t.provider_webhooks.push({ provider: "whatsapp_cloud", event_type: "message", payload: { from: "2348033334444" }, received_at: new Date().toISOString() });
  await sendAll(api, { channels: ["whatsapp"] });
  assert.equal(providers.whatsapp[1].type, "text"); assert.equal(providers.whatsapp[1].text.body, "Hello Chika");
  db.t.provider_webhooks[0].received_at = new Date(Date.now() - 25 * 3600e3).toISOString();      // window closed
  await sendAll(api, { channels: ["whatsapp"] });
  assert.equal(providers.whatsapp[2].type, "template");
});
test("whatsapp: no approved template configured means skip, never send free text to a stranger", async () => {
  const api = load(ENV), db = create({ member_preferences: [prefs()], communication_settings: [live] }), { providers } = db.install();
  const { WHATSAPP_TEMPLATE, ...none } = ENV;
  const r = await sendAll(load(none), { channels: ["whatsapp"] });
  assert.equal(r.whatsapp, "skipped"); assert.equal(providers.whatsapp.length, 0);
});
test("email: HTML + plain text, unsubscribe link and one-click header for members", async () => {
  const api = load(ENV), db = create({ member_preferences: [prefs()], communication_settings: [live] }); db.install();
  const t = fakeTransport(); api("_comms/providers/gmail.js")._setTransport(t);
  assert.equal((await sendAll(api, { channels: ["email"], subject: "Welcome" })).email, "sent");
  const m = t.sent[0];
  assert.equal(m.to, "chika@x.com"); assert.equal(m.subject, "Welcome"); assert.ok(m.html.includes("Hello Chika")); assert.match(m.text, /Unsubscribe: https:\/\/dcf\.test\/api\/comms\/unsubscribe\?t=/);
  assert.match(m.headers["List-Unsubscribe"], /^<https:\/\/dcf\.test\/api\/comms\/unsubscribe\?t=/); assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(db.t.message_log[0].provider, "gmail");
});

// ---------- WhatsApp webhook
const SECRET = "app-secret", WENV = { ...ENV, WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: "verify-me" };
const logRow = (o = {}) => ({ id: "L1", provider: "whatsapp_cloud", provider_message_id: "wamid.A", status: "sent", ...o });
const post = async (api, body, headers) => { const r = res(); await api("comms/[action].js")(req(body, headers, { query: { action: "whatsapp-webhook" } }), r); return r; };
test("whatsapp webhook: Meta's verification handshake needs the right token", async () => {
  const api = load(WENV), h = api("comms/[action].js");
  let r = res(); await h({ method: "GET", headers: {}, query: { action: "whatsapp-webhook", "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "12345" } }, r);
  assert.equal(r.code, 200); assert.equal(r.body, "12345");
  r = res(); await h({ method: "GET", headers: {}, query: { action: "whatsapp-webhook", "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1" } }, r);
  assert.equal(r.code, 403);
});
test("whatsapp webhook: a bad or missing signature is rejected and nothing is stored", async () => {
  const api = load(WENV), db = create({ message_log: [logRow()] }); db.install();
  const body = status("wamid.A", "delivered");
  for (const headers of [{}, { "x-hub-signature-256": "sha256=deadbeef" }, wa("wrong-secret", body)]) {
    const r = await post(api, body, headers); assert.equal(r.code, 401);
  }
  assert.equal(db.t.provider_webhooks.length, 0); assert.equal(db.t.message_log[0].status, "sent");
});
test("whatsapp webhook: refuses everything when the app secret is not configured", async () => {
  const { WHATSAPP_APP_SECRET, ...noSecret } = WENV; const api = load(noSecret), db = create(); db.install();
  const body = status("wamid.A", "delivered"); assert.equal((await post(api, body, wa(SECRET, body))).code, 503);
});
test("whatsapp webhook: sent -> delivered -> read updates the log, delivered is never undone", async () => {
  const api = load(WENV), db = create({ message_log: [logRow()] }); db.install();
  for (const s of ["sent", "delivered"]) { const b = status("wamid.A", s); assert.equal((await post(api, b, wa(SECRET, b))).code, 200); }
  assert.equal(db.t.message_log[0].status, "delivered"); assert.ok(db.t.message_log[0].delivered_at);
  const rd = status("wamid.A", "read"); await post(api, rd, wa(SECRET, rd));
  assert.equal(db.t.message_log[0].status, "delivered"); assert.equal(db.t.message_log[0].delivery_status, "read");
  const late = status("wamid.A", "failed"); await post(api, late, wa(SECRET, late));              // out-of-order failure must not win
  assert.equal(db.t.message_log[0].status, "delivered");
  assert.ok(db.t.provider_webhooks.every((w) => w.processed_at));
});
test("whatsapp webhook: a failure is recorded with the provider's reason", async () => {
  const api = load(WENV), db = create({ message_log: [logRow()] }); db.install();
  const b = status("wamid.A", "failed", { errors: [{ code: 131026, title: "Message undeliverable" }] }); await post(api, b, wa(SECRET, b));
  assert.equal(db.t.message_log[0].status, "failed"); assert.match(db.t.message_log[0].detail, /131026 Message undeliverable/);
});
test("whatsapp webhook: Meta retries are stored once and applied once", async () => {
  const api = load(WENV), db = create({ message_log: [logRow()] }); db.install();
  const b = status("wamid.A", "delivered");
  for (let i = 0; i < 3; i++) assert.equal((await post(api, b, wa(SECRET, b))).code, 200);
  assert.equal(db.t.provider_webhooks.length, 1);
});
test("whatsapp webhook: a status that arrives before the send was logged is kept and applied later", async () => {
  const api = load(WENV), db = create(); db.install();
  const b = status("wamid.A", "delivered"); await post(api, b, wa(SECRET, b));
  assert.equal(db.t.provider_webhooks[0].processed_at, undefined);           // nothing to attach it to yet
  db.t.message_log.push(logRow()); db.t.provider_webhooks[0].received_at = new Date(Date.now() - 60000).toISOString();
  const ping = status("wamid.B", "sent"); await post(api, ping, wa(SECRET, ping));   // any later webhook triggers the retry
  assert.equal(db.t.message_log[0].status, "delivered"); assert.ok(db.t.provider_webhooks[0].processed_at);
});
test("whatsapp webhook: STOP suppresses the number, switches off WhatsApp consent and confirms", async () => {
  const api = load({ ...WENV, WHATSAPP_TEMPLATE: "t" }), db = create({ members: [{ id: M, phone: "0803 333 4444" }, { id: "m2", phone: "0809 999 8888" }], member_preferences: [prefs(), prefs({ member_id: "m2" })], communication_settings: [live] }), { providers } = db.install();
  const b = inbound("2348033334444", " Stop "); assert.equal((await post(api, b, wa(SECRET, b))).code, 200);
  assert.deepEqual(db.t.contact_suppressions.map((s) => [s.channel, s.address, s.source]), [["whatsapp", "2348033334444", "stop_reply"]]);
  assert.equal(db.t.member_preferences[0].whatsapp_opt_in, false); assert.equal(db.t.member_preferences[0].sms_opt_in, true); assert.equal(db.t.member_preferences[1].whatsapp_opt_in, true);
  assert.equal(providers.whatsapp.length, 1); assert.equal(providers.whatsapp[0].type, "text"); assert.match(providers.whatsapp[0].text.body, /unsubscribed/);
  // and from now on nothing more is sent to them on WhatsApp
  const r = await sendAll(load({ ...ENV, WHATSAPP_TEMPLATE: "t" }), { channels: ["whatsapp"] }); assert.equal(r.whatsapp, "skipped"); assert.equal(r.reasons.whatsapp, "no consent for whatsapp");
});
test("whatsapp webhook: ordinary replies are stored (opening the 24h window) but trigger nothing else", async () => {
  const api = load(WENV), db = create({ communication_settings: [live] }), { providers } = db.install();
  const b = inbound("2348033334444", "Thank you, God bless"); await post(api, b, wa(SECRET, b));
  assert.equal(db.t.provider_webhooks[0].event_type, "message"); assert.equal(db.t.contact_suppressions.length, 0); assert.equal(providers.whatsapp.length, 0);
});
test("whatsapp webhook: the STOP confirmation respects test mode", async () => {
  const api = load({ ...WENV, WHATSAPP_TEMPLATE: "t" }), db = create({ communication_settings: [{ key: "test_mode", value: { enabled: true, recipients: [] } }] }), { providers } = db.install();
  const b = inbound("2348033334444", "STOP"); await post(api, b, wa(SECRET, b));
  assert.equal(db.t.contact_suppressions.length, 1); assert.equal(providers.whatsapp.length, 0);   // opt-out honoured, reply held back
});

// ---------- Termii webhook
const TENV = { ...ENV, TERMII_WEBHOOK_SECRET: "t-secret" };
const tsig = (secret, body) => ({ "x-termii-signature": crypto.createHmac("sha512", secret).update(body).digest("hex") });
const tpost = async (api, body, headers, query = {}) => { const r = res(); await api("comms/[action].js")(req(body, headers, { query: { action: "termii-webhook", ...query } }), r); return r; };
test("termii webhook: valid HMAC-SHA512 signature updates delivery; invalid is rejected", async () => {
  const api = load(TENV), db = create({ message_log: [logRow({ provider: "termii", provider_message_id: "TM9" })] }); db.install();
  const body = JSON.stringify({ message_id: "TM9", status: "DELIVRD" });
  assert.equal((await tpost(api, body, tsig("wrong", body))).code, 401); assert.equal(db.t.provider_webhooks.length, 0);
  assert.equal((await tpost(api, body, tsig("t-secret", body))).code, 200);
  assert.equal(db.t.message_log[0].status, "delivered"); assert.equal(db.t.message_log[0].delivery_status, "DELIVRD");
});
test("termii webhook: a shared token in the URL is an accepted alternative", async () => {
  const api = load({ ...ENV, TERMII_WEBHOOK_TOKEN: "tok123" }), db = create({ message_log: [logRow({ provider: "termii", provider_message_id: "TM9" })] }); db.install();
  const body = JSON.stringify({ data: { message_id: "TM9", status: "failed", error: "Number blocked" } });
  assert.equal((await tpost(api, body, {}, { token: "nope" })).code, 401);
  assert.equal((await tpost(api, body, {}, { token: "tok123" })).code, 200);
  assert.equal(db.t.message_log[0].status, "failed"); assert.match(db.t.message_log[0].detail, /blocked/);
});
test("termii webhook: unknown payloads are stored for inspection, never guessed at", async () => {
  const api = load(TENV), db = create(); db.install();
  const body = JSON.stringify({ something: "new" }); assert.equal((await tpost(api, body, tsig("t-secret", body))).code, 200);
  assert.equal(db.t.provider_webhooks.length, 1); assert.equal(db.t.provider_webhooks[0].error, "unrecognised event");
});
test("termii webhook: refuses everything when no secret or token is set", async () => {
  const { TERMII_API_KEY, TERMII_WEBHOOK_SECRET, ...none } = TENV; const api = load(none), db = create(); db.install();
  const body = JSON.stringify({ message_id: "x", status: "sent" }); assert.equal((await tpost(api, body, tsig("t-secret", body))).code, 503);
});

// ---------- unsubscribe
const mkToken = () => { process.env.UNSUBSCRIBE_SECRET = "unsub-secret"; return require("../api/_comms/token").sign({ m: M, c: "email" }); };
const unsub = async (api, method, t) => { const r = res(); await api("comms/[action].js")({ method, headers: {}, query: { action: "unsubscribe", t } }, r); return r; };
test("unsubscribe: opening the link (GET) changes nothing, the button (POST) does", async () => {
  const api = load(ENV), db = create({ members: [{ id: M, email: "Chika@X.com" }], member_preferences: [prefs()] }); db.install(); const t = mkToken();
  let r = await unsub(api, "GET", t); assert.equal(r.code, 200); assert.match(r.body, /Yes, unsubscribe me/);
  assert.equal(db.t.member_preferences[0].email_opt_in, true); assert.equal(db.t.contact_suppressions.length, 0);
  r = await unsub(api, "POST", t); assert.equal(r.code, 200); assert.match(r.body, /Unsubscribed/);
  assert.equal(db.t.member_preferences[0].email_opt_in, false); assert.equal(db.t.member_preferences[0].sms_opt_in, true);
  assert.deepEqual(db.t.contact_suppressions.map((s) => [s.channel, s.address, s.source]), [["email", "chika@x.com", "unsubscribe_link"]]);
});
test("unsubscribe: forged or missing tokens do nothing", async () => {
  const api = load(ENV), db = create({ members: [{ id: M, email: "c@x.com" }], member_preferences: [prefs()] }); db.install(); mkToken();
  for (const t of ["", "nonsense", "abc.def"]) { const r = await unsub(api, "POST", t); assert.equal(r.code, 400); }
  assert.equal(db.t.member_preferences[0].email_opt_in, true);
});
test("router: unknown actions return 404", async () => {
  const api = load(ENV), r = res(); await api("comms/[action].js")({ method: "GET", headers: {}, query: { action: "nope" } }, r); assert.equal(r.code, 404);
});
