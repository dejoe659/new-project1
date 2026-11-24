const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");
const E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
function setup(startsInMs) {
  const api = load({ ...PROVIDERS });
  const db = create({ events: [{ id: E, title: "Retreat", starts_at: new Date(Date.now() + startsInMs).toISOString(), capacity: 2, registration_open: true }],
    event_registrations: [{ id: "r1", event_id: E, full_name: "Ada Obi", phone: "08031234567", phone_key: "2348031234567", attended: false }] });
  db.install({}); const router = api("comms/[action].js");
  return { db, call: async (body) => { const r = res(); await router({ method: "POST", query: { action: "events" }, headers: {}, body }, r); return r; } };
}
test("a registered person scans, enters their phone, and is marked present", async () => {
  const s = setup(60 * 60e3); const r = await s.call({ action: "checkin", event_id: E, phone: "0803 123 4567" });
  assert.equal(r.code, 200); assert.equal(r.body.status, "ok"); assert.equal(r.body.name, "Ada Obi");
  assert.equal(s.db.t.event_registrations[0].attended, true);
});
test("an unknown number is asked for a name, then recorded as a walk-in who is present", async () => {
  const s = setup(60 * 60e3);
  assert.equal((await s.call({ action: "checkin", event_id: E, phone: "08090000000" })).body.status, "not_found"); assert.equal(s.db.t.event_registrations.length, 1);
  const r = await s.call({ action: "checkin", event_id: E, phone: "08090000000", full_name: "Walk In" });
  assert.equal(r.body.status, "ok"); assert.equal(s.db.t.event_registrations.length, 2); assert.equal(s.db.t.event_registrations[1].attended, true);
});
test("check-in is closed too early and too late, and bad input is refused", async () => {
  assert.equal((await setup(5 * 3600e3).call({ action: "checkin", event_id: E, phone: "08031234567" })).code, 409);
  assert.equal((await setup(-13 * 3600e3).call({ action: "checkin", event_id: E, phone: "08031234567" })).code, 409);
  const s = setup(0);
  assert.equal((await s.call({ action: "checkin", event_id: "nope", phone: "08031234567" })).code, 400);
  assert.equal((await s.call({ action: "checkin", event_id: E, phone: "12" })).code, 400);
  assert.equal((await s.call({ action: "checkin", event_id: E, phone: "08031234567" })).code, 200);   // right at the start
});
