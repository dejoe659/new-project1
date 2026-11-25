// Daily job (Vercel cron) and manual catch-up. Sends campaigns whose time has come, retries temporary failures,
// and closes finished campaigns. Protected by CRON_SECRET, exactly like the follow-up job.
const crypto = require("crypto");
const { hasSrv } = require("./db");
const queue = require("./queue");
const absence = require("./absence");
const visitors = require("./visitors");
const eventReminders = require("./event-reminders");
const weekly = require("./weekly");
const memberWelcome = require("./members-welcome");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !same(req.headers.authorization || "", "Bearer " + secret)) return res.status(401).json({ error: "Unauthorized" });
  if (!hasSrv()) return res.status(503).json({ error: "Server key missing." });
  const started = [];
  for (const c of await queue.dueCampaigns()) { const r = await queue.expandCampaign(c); if (r.started) started.push({ id: c.id, queued: r.queued }); }
  let followUp;
  try { followUp = await absence.run(); } catch (e) { console.error("absence follow-up failed:", e); followUp = { error: true }; }   // never blocks the rest of the job
  let welcomed;
  try { welcomed = await visitors.welcome(); } catch (e) { console.error("visitor welcome failed:", e); welcomed = { error: true }; }
  let reminded;
  try { reminded = await eventReminders.run(); } catch (e) { console.error("event reminders failed:", e); reminded = { error: true }; }
  let memberWelcomed;
  try { memberWelcomed = await memberWelcome.run(); } catch (e) { console.error("member welcome failed:", e); memberWelcomed = { error: true }; }
  let summary;
  try { summary = weekly.isMondayInLagos() ? await weekly.run() : { skipped: true }; } catch (e) { console.error("weekly summary failed:", e); summary = { error: true }; }
  const r = await queue.runBatch({ limit: 25, workerId: "cron" });
  res.status(200).json({ started, followUp, welcomed, memberWelcomed, reminded, summary, ...r });
};
