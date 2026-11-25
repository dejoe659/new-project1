const test = require("node:test");
const assert = require("node:assert/strict");
const { load, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");
const now = () => new Date().toISOString();
const M = (n, extra = {}) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, full_name: `Ada Obi${n}`, email: `a${n}@x.com`, phone: "08031234567", review_status: "new", created_at: now(), ...extra });
const P = (m, extra = {}) => ({ member_id: m.id, email_opt_in: true, sms_opt_in: false, whatsapp_opt_in: false, opted_out: false, ...extra });
function setup(rule, members, prefs, extra = {}) {
  const api = load({ ...PROVIDERS });
  const db = create({ automation_rules: rule ? [{ key: "welcome", ...rule }] : [], members, member_preferences: prefs, ...extra });
  db.install({});
  return { db, run: (o) => api("_comms/members-welcome.js").run(o) };
}
const ON = { mode: "automatic", channels: ["email"] };
test("welcome is off unless the rule is automatic with email", async () => {
  const m = M(1);
  assert.equal((await setup({ mode: "disabled", channels: [] }, [m], [P(m)]).run()).enabled, false);
  const s = setup({ mode: "automatic", channels: ["sms"] }, [m], [P(m)]);
  assert.equal((await s.run()).queued, 0); assert.equal((s.db.t.message_queue || []).length, 0);
});
test("one welcome per consenting member, with the helpful links, and never twice", async () => {
  const [a, b, c] = [M(1), M(2), M(3)];
  const s = setup(ON, [a, b, c], [P(a), P(b, { email_opt_in: false }), P(c, { opted_out: true })]);
  assert.equal((await s.run()).queued, 1);
  const q = s.db.t.message_queue; assert.equal(q.length, 1);
  assert.equal(q[0].category, "welcome"); assert.equal(q[0].recipient_address, "a1@x.com");
  assert.match(q[0].body, /\/freshers/); assert.match(q[0].body, /\/academic/);
  await s.run(); assert.equal(s.db.t.message_queue.length, 1);
});
test("members already welcomed by the old welcome are skipped", async () => {
  const a = M(1);
  const s = setup(ON, [a], [P(a)], { message_log: [{ kind: "welcome", member_id: a.id }] });
  assert.equal((await s.run()).queued, 0);
});
