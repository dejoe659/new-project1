// Public events endpoint: the list of upcoming and past programmes, and registration for an event.
//   POST /api/comms/events   { action: "list" }
//   POST /api/comms/events   { action: "register", event_id, full_name, phone, email?, agree: true }
// Registration is written with the server key (the public cannot read or write registrations directly), so the rules below cannot be bypassed.
const { srv, hasSrv } = require("./db");
const { normalize } = require("./phone");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const COLS = "id,title,date,venue,details,starts_at,poster_url,capacity,registration_open";
class Bad extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }

// How many people have registered per event (the public only ever sees the count, never names).
async function counts(ids) {
  if (!ids.length) return {};
  const rows = await srv(`event_registrations?event_id=in.(${ids.join(",")})&select=event_id&limit=20000`);
  const c = {}; for (const r of rows) c[r.event_id] = (c[r.event_id] || 0) + 1; return c;
}
const shape = (e, taken, now) => {
  const past = e.starts_at ? new Date(e.starts_at).getTime() < now : false;
  const left = e.capacity ? Math.max(0, e.capacity - (taken[e.id] || 0)) : null;
  return { id: e.id, title: e.title, date: e.date, venue: e.venue, details: e.details, starts_at: e.starts_at, poster_url: e.poster_url, capacity: e.capacity, spots_left: left, past,
    can_register: !!e.starts_at && !past && e.registration_open !== false && (left === null || left > 0), full: left === 0 };
};

const actions = {
  async list() {
    const now = Date.now();
    const rows = await srv(`events?starts_at=not.is.null&select=${COLS}&order=starts_at.asc&limit=200`);
    const taken = await counts(rows.map((e) => e.id));
    const all = rows.map((e) => shape(e, taken, now));
    return { upcoming: all.filter((e) => !e.past), past: all.filter((e) => e.past).reverse() };
  },
  async register(b) {
    if (b.website) return { message: "Thank you." };                                            // honeypot
    if (!UUID.test(String(b.event_id || ""))) throw new Bad("Unknown event.");
    const name = typeof b.full_name === "string" ? b.full_name.trim().slice(0, 120) : "";
    if (name.length < 2) throw new Bad("Enter your full name.");
    const p = normalize(String(b.phone || ""));
    if (!p.ok) throw new Bad("Enter a valid phone number.");
    let email = typeof b.email === "string" ? b.email.trim().toLowerCase().slice(0, 200) : "";
    if (email && !EMAIL_RE.test(email)) throw new Bad("That email address is not valid.");
    if (email && b.agree !== true) throw new Bad("Tick the box to agree to receive the reminder email, or leave the email blank.");
    if (!email) email = null;
    const ev = (await srv(`events?id=eq.${b.event_id}&select=${COLS}&limit=1`))[0];
    if (!ev) throw new Bad("That event was not found.", 404);
    if (!ev.starts_at || new Date(ev.starts_at).getTime() < Date.now()) throw new Bad("This event has already taken place.", 409);
    if (ev.registration_open === false) throw new Bad("Registration for this event is closed.", 409);
    const existing = await srv(`event_registrations?event_id=eq.${ev.id}&select=id,phone_key,created_at&limit=20000`);
    if (existing.some((r) => r.phone_key === p.digits)) throw new Bad("This phone number is already registered for this event.", 409);
    if (ev.capacity && existing.length >= ev.capacity) throw new Bad("Sorry, this event is full.", 409);
    let mine;
    try {
      mine = (await srv("event_registrations", { method: "POST", json: true, headers: { Prefer: "return=representation" },
        body: JSON.stringify({ event_id: ev.id, full_name: name, phone: String(b.phone).trim().slice(0, 30), phone_key: p.digits, email }) }))[0];
    } catch (e) { throw new Bad("This phone number is already registered for this event.", 409); }   // the database also refuses duplicates
    // Two people may arrive at the same moment. Whoever is past the limit (by time, then id) is removed again, so the event is never over-booked.
    if (ev.capacity) {
      const all = (await srv(`event_registrations?event_id=eq.${ev.id}&select=id,created_at&limit=20000`))
        .sort((a, c) => String(a.created_at).localeCompare(String(c.created_at)) || String(a.id).localeCompare(String(c.id)));
      if (all.findIndex((r) => r.id === mine.id) >= ev.capacity) {
        await srv(`event_registrations?id=eq.${mine.id}`, { method: "DELETE" });
        throw new Bad("Sorry, this event has just become full.", 409);
      }
    }
    return { message: `You are registered for ${ev.title}.${email ? " We will email you a reminder." : ""}` };
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!hasSrv()) return res.status(503).json({ error: "Server setup is incomplete." });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const name = String(b.action || "");
  if (!Object.prototype.hasOwnProperty.call(actions, name)) return res.status(400).json({ error: "Unknown action." });
  if (name === "list") res.setHeader("Cache-Control", "s-maxage=30");
  try { res.status(200).json(await actions[name](b)); }
  catch (e) {
    if (e instanceof Bad) return res.status(e.code).json({ error: e.message });
    console.error("events failed:", e);
    res.status(500).json({ error: "Server error. Please try again." });
  }
};
