// One-click unsubscribe for emails. A GET only SHOWS a confirmation page (mail scanners open links, and must not
// unsubscribe anyone). The POST, from the page's button or from a mail app's one-click, does the work.
const token = require("./token");
const store = require("./webhook-store");
const { srv } = require("./db");
const { esc } = require("./email-template");

const page = (res, code, title, msg, form) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(code).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="font-family:Arial,sans-serif;background:#f3f6ee;margin:0;padding:24px"><div style="max-width:460px;margin:40px auto;background:#fff;border-radius:10px;padding:28px;text-align:center">
<h2 style="color:#14451f;margin-top:0">Dunamis Campus Fellowship</h2><p>${esc(msg)}</p>${form || ""}</div></body></html>`);
};

module.exports = async (req, res) => {
  const t = (req.query && req.query.t) || "", data = token.verify(t);
  if (!data || data.c !== "email" || !data.m) return page(res, 400, "Invalid link", "This unsubscribe link is not valid. Please ask a leader to stop your emails.");
  if (req.method === "GET") return page(res, 200, "Unsubscribe", "Do you want to stop receiving emails from Dunamis Campus Fellowship?",
    `<form method="POST" action="/api/comms/unsubscribe?t=${esc(encodeURIComponent(t))}"><button style="background:#14451f;color:#fff;border:0;border-radius:8px;padding:12px 22px;font-size:16px;cursor:pointer">Yes, unsubscribe me</button></form>`);
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    const m = await srv(`members?id=eq.${encodeURIComponent(data.m)}&select=id,email&limit=1`);
    if (m.length) {
      await srv(`member_preferences?member_id=eq.${m[0].id}`, { method: "PATCH", body: JSON.stringify({ email_opt_in: false, consent_source: "member_request" }) });
      if (m[0].email) await store.suppress("email", String(m[0].email).trim().toLowerCase(), "unsubscribe_link", "Used the unsubscribe link");
    }
    return page(res, 200, "Unsubscribed", "You have been unsubscribed. You will not receive any more emails from us. God bless you.");
  } catch (e) { console.error("unsubscribe failed:", e.message); return page(res, 500, "Try again", "Something went wrong. Please try again, or ask a leader to stop your emails."); }
};
