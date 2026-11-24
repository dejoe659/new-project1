// Monday summary for the fellowship inbox: numbers only, never names or request text.
const { srv } = require("./db");
const { mail } = require("../_lib");
const enc = encodeURIComponent;
const count = async (path) => (await srv(path + "&select=id&limit=1000")).length;

async function build(now = Date.now()) {
  const wk = enc(new Date(now - 7 * 864e5).toISOString()), nowIso = enc(new Date(now).toISOString());
  const [newMembers, pending, att, careOpen, acadOpen, upcoming, failed] = await Promise.all([
    count(`members?created_at=gte.${wk}`), count("members?review_status=eq.pending"), count(`attendance?created_at=gte.${wk}`),
    count("care_requests?status=in.(new,in_progress)"), count("academic_requests?status=in.(new,in_progress)"), count(`events?starts_at=gt.${nowIso}`),
    count(`message_queue?status=in.(failed,dead_letter)&created_at=gte.${wk}`),
  ]);
  return { newMembers, pending, att, careOpen, acadOpen, upcoming, failed };
}
async function run(now = Date.now()) {
  const n = await build(now);
  const lines = [`New members this week: ${n.newMembers}`, `Registrations waiting for approval: ${n.pending}`, `Check-ins this week: ${n.att}`, `Open prayer and counselling requests: ${n.careOpen}`, `Open academic help requests: ${n.acadOpen}`, `Upcoming events: ${n.upcoming}`, `Messages that failed this week: ${n.failed}`];
  await mail("DCF UNN weekly summary", lines.join("\n") + "\n\nOpen the admin page for details: https://dcf-unn-site.vercel.app/admin");
  return { sent: true, ...n };
}
// Lagos is UTC+1: Monday there is Monday here from 23:00 Sunday UTC.
const isMondayInLagos = (now = Date.now()) => new Date(now + 36e5).getUTCDay() === 1;
module.exports = { run, build, isMondayInLagos };
