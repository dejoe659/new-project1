const test = require("node:test");
const assert = require("node:assert/strict");
const { load, res, PROVIDERS } = require("./helpers");
const { create } = require("./fakedb");

function run(type, tables = {}) {
  const api = load({ ...PROVIDERS });
  const db = create({ resources: [], events: [], ...tables });
  db.install({});
  const urls = [];
  const inner = global.fetch;
  global.fetch = async (u, o) => { urls.push(String(u)); return inner(u, o); };
  const r = res();
  return api("public.js")({ method: "GET", query: { type } }, r).then(() => ({ r, urls }));
}

test("the public resources feed asks only for published rows and safe columns", async () => {
  const { r, urls } = await run("resources", { resources: [{ id: "1", title: "A", kind: "sermon", is_published: true }] });
  assert.equal(r.code, 200);
  const q = urls.find((u) => u.includes("/rest/v1/resources"));
  assert.ok(q.includes("is_published=eq.true"), "published only");
  assert.equal(/created_by|is_published=eq.false/.test(q.split("select=")[1].split("&")[0]), false, "internal columns are not requested");
});

test("the homepage events feed is unchanged by the new events features", async () => {
  const { urls } = await run("events");
  const q = urls.find((u) => u.includes("/rest/v1/events"));
  assert.ok(q.includes("select=title,date,venue,details&order=date.asc&limit=20"), "same columns and order as before");
});

test("unknown public feeds are refused", async () => {
  const { r } = await run("care_requests");
  assert.equal(r.code, 400);
});
