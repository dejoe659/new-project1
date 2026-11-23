// One serverless function for every new communication endpoint (keeps the project well inside Vercel's function limit).
//   /api/comms/whatsapp-webhook   /api/comms/termii-webhook   /api/comms/unsubscribe
const routes = {
  "whatsapp-webhook": require("../_comms/whatsapp-webhook"),
  "termii-webhook": require("../_comms/termii-webhook"),
  unsubscribe: require("../_comms/unsubscribe"),
  campaigns: require("../_comms/campaigns"),
  "queue-run": require("../_comms/queue-run"),
  events: require("../_comms/events"),
  care: require("../_comms/care"),
};
module.exports = async (req, res) => {
  const h = routes[String((req.query && req.query.action) || "")];
  if (!h) return res.status(404).json({ error: "Not found." });
  try { await h(req, res); }
  catch (e) { console.error("comms route failed:", e); if (!res.headersSent) res.status(500).json({ error: "Server error." }); }
};
