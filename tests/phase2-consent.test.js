const test = require("node:test");
const assert = require("node:assert/strict");
const { load, mockFetch, res, PROVIDERS } = require("./helpers");
const M = "11111111-1111-1111-1111-111111111111";
const member = { id: M, full_name: "Chika Okafor", email: "c@x.com", phone: "08033334444" };
const send = async (api, m, channels = ["sms", "whatsapp"]) => api("_notify.js").sendAll({ member: m, channels, message: "Hello {name}", kind: "manual" });
const allOn = { whatsapp_opt_in: true, sms_opt_in: true, email_opt_in: true, opted_out: false };

test("consent: only the channels a member opted into are used", async () => {
  const api = load(PROVIDERS), calls = mockFetch({ prefs: { ...allOn, whatsapp_opt_in: false } });
  const r = await send(api, member);
  assert.deepEqual(r, { sms: "sent", whatsapp: "skipped" });
  assert.equal(calls.sent("sms"), 1); assert.equal(calls.sent("whatsapp"), 0);
});
test("consent: a global opt-out blocks every channel", async () => {
  const api = load(PROVIDERS), calls = mockFetch({ prefs: { ...allOn, opted_out: true } });
  const r = await send(api, member);
  assert.deepEqual(r, { sms: "skipped", whatsapp: "skipped" });
  assert.equal(calls.sent("sms") + calls.sent("whatsapp"), 0);
});
test("consent: no consent record means no message", async () => {
  const api = load(PROVIDERS), calls = mockFetch({ prefs: null });
  await send(api, member);
  assert.equal(calls.sent("sms") + calls.sent("whatsapp"), 0);
});
test("opt-out: a suppressed number is skipped only on the suppressed channel", async () => {
  const api = load(PROVIDERS), calls = mockFetch({ prefs: allOn, suppressed: ["sms"] });
  const r = await send(api, member);
  assert.deepEqual(r, { sms: "skipped", whatsapp: "sent" });
  assert.equal(calls.sent("sms"), 0); assert.equal(calls.sent("whatsapp"), 1);
});
test("opt-out: a suppression for 'all' blocks every channel", async () => {
  const api = load(PROVIDERS), calls = mockFetch({ prefs: allOn, suppressed: ["all"] });
  await send(api, member);
  assert.equal(calls.sent("sms") + calls.sent("whatsapp"), 0);
});
test("visitors: SMS and WhatsApp allowed, email never, suppression still honoured", async () => {
  const v = { attendance_id: "a1", full_name: "Tunde", phone: "07011112222", email: "t@x.com" };
  let api = load(PROVIDERS), calls = mockFetch({});
  assert.deepEqual(await send(api, v, ["sms", "whatsapp", "email"]), { sms: "sent", whatsapp: "sent", email: "skipped" });
  api = load(PROVIDERS); calls = mockFetch({ suppressed: ["sms"] });
  assert.equal((await send(api, v, ["sms"])).sms, "skipped"); assert.equal(calls.sent("sms"), 0);
});
test("fails closed: database down means nothing is sent", async () => {
  const api = load(PROVIDERS), calls = mockFetch({ prefs: allOn, dbDown: true });
  await send(api, member);
  assert.equal(calls.sent("sms") + calls.sent("whatsapp"), 0);
});
test("fails closed: without the service key a saved member cannot be messaged", async () => {
  const { SUPABASE_SERVICE_ROLE_KEY, ...noKey } = PROVIDERS;
  const api = load(noKey), calls = mockFetch({ prefs: allOn });
  await send(api, member);
  assert.equal(calls.sent("sms") + calls.sent("whatsapp"), 0);
});
test("explicit consent from the join form is honoured, but only when test mode can be confirmed off", async () => {
  const api = load(PROVIDERS), calls = mockFetch({});
  const r = await send(api, { full_name: "Ada", phone: "08031234567", consent: { sms: true, whatsapp: false, email: false } });
  assert.deepEqual(r, { sms: "sent", whatsapp: "skipped" });
  assert.equal(calls.sent("sms"), 1);
});
test("fails closed: without the service key nothing is sent, even with explicit consent", async () => {
  const { SUPABASE_SERVICE_ROLE_KEY, ...noKey } = PROVIDERS;
  const api = load(noKey), calls = mockFetch({});
  await send(api, { full_name: "Ada", phone: "08031234567", consent: { sms: true, whatsapp: true, email: true } });
  assert.equal(calls.sent("sms") + calls.sent("whatsapp"), 0);
});
test("phone numbers are normalised to international form", async () => {
  const api = load(PROVIDERS), calls = mockFetch({ prefs: allOn });
  await send(api, { ...member, phone: "0803 333 4444" }, ["sms"]);
  assert.equal(calls.find(c => c.url.includes("termii")).body.to, "2348033334444");
});

test("registration: ticked channels are stored and consent is derived from them", async () => {
  const api = load({}), calls = mockFetch({}), r = res();
  await api("register.js")({ method: "POST", body: { full_name: "Ada Eze", email: "ada@x.com", phone: "08031234567", department: "CRE", date_of_birth: "2005-01-01",
    state_of_origin: "Enugu", local_government: "Nsukka", hostel_address: "Block C, Room 4", pref_email: true, pref_sms: false, photo_url: "https://evil.example/x.jpg" } }, r);
  const row = calls.find(c => c.url.includes("/rest/v1/members")).body;
  assert.equal(r.code, 200);
  assert.deepEqual([row.reg_pref_whatsapp, row.reg_pref_sms, row.reg_pref_email, row.consent_comms], [false, false, true, true]);
  assert.equal(row.hostel_address, "Block C, Room 4");
  assert.equal(row.photo_url, null);
  assert.equal(row.profile_approved, false);
});
test("registration: ticking nothing is allowed and means no consent", async () => {
  const api = load({}), calls = mockFetch({}), r = res();
  await api("register.js")({ method: "POST", body: { full_name: "Ada", email: "a@x.com", phone: "0803", department: "CRE", date_of_birth: "2005-01-01", state_of_origin: "E", local_government: "N", consent_comms: true } }, r);
  const row = calls.find(c => c.url.includes("/rest/v1/members")).body;
  assert.equal(r.code, 200); assert.equal(row.consent_comms, false);   // the old single flag no longer grants anything
});
test("welcome message is OFF by default", async () => {
  const api = load(PROVIDERS), calls = mockFetch({}), r = res();
  await api("register.js")({ method: "POST", body: { full_name: "Ada", email: "a@x.com", phone: "08031234567", department: "CRE", date_of_birth: "2005-01-01", state_of_origin: "E", local_government: "N", pref_sms: true } }, r);
  assert.equal(calls.sent("sms") + calls.sent("whatsapp"), 0);
});
test("welcome message (switched on) uses only the ticked channels", async () => {
  const api = load({ ...PROVIDERS, AUTO_WELCOME: "on" }), calls = mockFetch({}), r = res();
  await api("register.js")({ method: "POST", body: { full_name: "Ada Eze", email: "a@x.com", phone: "08031234567", department: "CRE", date_of_birth: "2005-01-01", state_of_origin: "E", local_government: "N", pref_sms: true, pref_whatsapp: false } }, r);
  assert.equal(calls.sent("sms"), 1); assert.equal(calls.sent("whatsapp"), 0);
  assert.match(calls.find(c => c.url.includes("termii")).body.sms, /^Hello Ada,/);
});
test("welcome message (switched on) sends nothing when no channel was ticked", async () => {
  const api = load({ ...PROVIDERS, AUTO_WELCOME: "on" }), calls = mockFetch({}), r = res();
  await api("register.js")({ method: "POST", body: { full_name: "Ada", email: "a@x.com", phone: "08031234567", department: "CRE", date_of_birth: "2005-01-01", state_of_origin: "E", local_government: "N" } }, r);
  assert.equal(r.code, 200); assert.equal(calls.sent("sms") + calls.sent("whatsapp"), 0);
});
test("registration: the honeypot field silently drops bots", async () => {
  const api = load({}), calls = mockFetch({}), r = res();
  await api("register.js")({ method: "POST", body: { website: "http://spam", full_name: "Bot" } }, r);
  assert.equal(calls.filter(c => c.url.includes("/rest/v1/members")).length, 0);
});
test("admin send respects each member's channel consent", async () => {
  const api = load(PROVIDERS), calls = mockFetch({ prefs: { ...allOn, whatsapp_opt_in: false } }), r = res();
  await api("followup.js")({ method: "POST", headers: { authorization: "Bearer t" }, body: { member_ids: [M], channels: ["sms", "whatsapp"], message: "Hello {name}" } }, r);
  assert.equal(r.code, 200); assert.equal(calls.sent("sms"), 1); assert.equal(calls.sent("whatsapp"), 0);
});
