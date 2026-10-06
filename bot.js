// WhatsApp chat-options bot. No npm packages needed: plain Node 18+.
// Settings come from environment variables (see docker-compose.yml).
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;       // any secret word you choose; also typed into Meta
const APP_SECRET = process.env.APP_SECRET || "";     // App settings > Basic > App secret
const APP_ID = process.env.APP_ID || "";             // only needed for the signup page
const ES_CONFIG_ID = process.env.ES_CONFIG_ID || ""; // only needed for the signup page
const SIGNUP_ENABLED = process.env.SIGNUP_ENABLED === "1";
const PAUSE_MINUTES = Number(process.env.HUMAN_PAUSE_MINUTES || 120);
const GRAPH_VERSION = "v25.0";
const GRAPH = process.env.GRAPH_URL || `https://graph.facebook.com/${GRAPH_VERSION}`;

// Number + token. The signup page saves them to connected.json, which wins over the env vars.
const CONNECTED_FILE = path.join(process.env.DATA_DIR || __dirname, "connected.json");
let WA_TOKEN = process.env.WA_TOKEN;
let PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
try {
  const saved = JSON.parse(fs.readFileSync(CONNECTED_FILE, "utf8"));
  WA_TOKEN = saved.token;
  PHONE_NUMBER_ID = saved.phone_number_id;
  console.log("Using connected number", PHONE_NUMBER_ID, "from connected.json");
} catch {}

// ---- What the bot says. Edit freely. ----
const MENU = {
  type: "button",
  body: { text: "Hi! What would you like to do?" },
  action: {
    buttons: [
      { type: "reply", reply: { id: "book", title: "Book a haircut" } },
      { type: "reply", reply: { id: "info", title: "Prices & hours" } },
      { type: "reply", reply: { id: "human", title: "Talk to a person" } },
    ],
  },
};

const TIMES = {
  type: "list",
  body: { text: "Pick a time for your haircut:" },
  action: {
    button: "Choose a time",
    sections: [
      {
        title: "Tomorrow",
        rows: [
          { id: "slot_10", title: "10:00" },
          { id: "slot_12", title: "12:00" },
          { id: "slot_16", title: "16:00" },
        ],
      },
    ],
  },
};

const ANSWERS = {
  info: "Haircut: S/ 30\nBeard trim: S/ 15\nHaircut + beard: S/ 40\n\nMon-Sat 9:00-20:00\nSunday closed",
  human: "Got it! A barber will reply here soon. 💈",
};

// ---- Staying out of the way of humans ----
// pausedUntil: the bot stays quiet with a customer after a human replies from the
// WhatsApp Business app, or after the customer asks for a person.
// lastMenuAt: free text right after the menu is left for a human to read in the app.
const pausedUntil = new Map();
const lastMenuAt = new Map();
const MENU_QUIET_MS = 30 * 60 * 1000;

function pause(customer) {
  pausedUntil.set(customer, Date.now() + PAUSE_MINUTES * 60 * 1000);
}

// Decide what to send back for one incoming message.
function handle(msg) {
  const from = msg.from;
  let choice = null;
  if (msg.type === "interactive") {
    const i = msg.interactive;
    choice = (i.button_reply || i.list_reply || {}).id;
  }
  const typed = msg.type === "text" ? msg.text.body.trim().toLowerCase() : "";

  // Typing "menu" always brings the bot back.
  if (typed === "menu") {
    pausedUntil.delete(from);
    return sendMenu(from);
  }
  if ((pausedUntil.get(from) || 0) > Date.now()) {
    console.log("Paused for", from, "- leaving it to a human");
    return Promise.resolve();
  }

  if (choice === "book") return send(from, { type: "interactive", interactive: TIMES });
  if (choice && choice.startsWith("slot_")) {
    const time = choice.slice(5) + ":00";
    return send(from, { type: "text", text: { body: `Booked for tomorrow at ${time}. See you then! ✂️` } });
  }
  if (choice === "human") {
    pause(from);
    return send(from, { type: "text", text: { body: ANSWERS.human } });
  }
  if (ANSWERS[choice]) return send(from, { type: "text", text: { body: ANSWERS[choice] } });

  // Free text: show the menu, unless they just got it (then a human reads it in the app).
  if (Date.now() - (lastMenuAt.get(from) || 0) < MENU_QUIET_MS) return Promise.resolve();
  return sendMenu(from);
}

function sendMenu(to) {
  lastMenuAt.set(to, Date.now());
  return send(to, { type: "interactive", interactive: MENU });
}

async function graph(method, urlPath, token, body) {
  const res = await fetch(`${GRAPH}/${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${urlPath} failed ${res.status}: ${JSON.stringify(out)}`);
  return out;
}

async function send(to, message) {
  try {
    await graph("POST", `${PHONE_NUMBER_ID}/messages`, WA_TOKEN, { messaging_product: "whatsapp", to, ...message });
    console.log("Sent", message.type, "to", to);
  } catch (e) {
    console.error("Send failed", e.message);
  }
}

// ---- Coexistence signup: connects a WhatsApp Business app number to this bot ----
function signupPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect WhatsApp</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px}button{font-size:18px;padding:12px 20px;background:#1877f2;color:#fff;border:0;border-radius:8px;cursor:pointer}#log{white-space:pre-wrap;margin-top:20px}</style>
</head><body>
<h1>Connect your WhatsApp Business app</h1>
<p>Click the button, choose to connect your existing WhatsApp Business app, enter the number, and scan the QR code with the app on your phone.</p>
<button onclick="start()">Connect WhatsApp</button>
<div id="log"></div>
<script>
const log = (t) => (document.getElementById("log").textContent += t + "\\n");
let ids = null, code = null;
window.fbAsyncInit = () => FB.init({ appId: ${JSON.stringify(APP_ID)}, autoLogAppEvents: true, xfbml: true, version: "${GRAPH_VERSION}" });
window.addEventListener("message", (e) => {
  if (!e.origin.endsWith("facebook.com")) return;
  try {
    const d = JSON.parse(e.data);
    if (d.type !== "WA_EMBEDDED_SIGNUP") return;
    if (d.event && d.event.startsWith("FINISH")) { ids = d.data; finish(); }
    else if (d.event === "CANCEL") log("Stopped at: " + (d.data.current_step || "unknown step"));
    else if (d.event === "ERROR") log("Meta error: " + d.data.error_message);
  } catch {}
});
function start() {
  FB.login((r) => { if (r.authResponse) { code = r.authResponse.code; finish(); } else log("Popup closed."); }, {
    config_id: ${JSON.stringify(ES_CONFIG_ID)}, response_type: "code", override_default_response_type: true,
    extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
  });
}
async function finish() {
  if (!ids || !code) return;
  log("Connecting...");
  const r = await fetch("signup/complete", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, waba_id: ids.waba_id, phone_number_id: ids.phone_number_id }) });
  log(await r.text());
}
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>
</body></html>`;
}

async function completeSignup({ code, waba_id, phone_number_id }) {
  // 1. Swap the one-time code for a long-lived business token.
  const q = new URLSearchParams({ client_id: APP_ID, client_secret: APP_SECRET, code });
  const res = await fetch(`${GRAPH}/oauth/access_token?${q}`);
  const tok = await res.json();
  if (!tok.access_token) throw new Error("Token exchange failed: " + JSON.stringify(tok));
  const token = tok.access_token;

  // 2. Let this app receive the account's webhooks. No /register call: the number
  //    is already registered by the Business app, which keeps working.
  await graph("POST", `${waba_id}/subscribed_apps`, token);

  // 3. Save and start using it right away.
  fs.writeFileSync(CONNECTED_FILE, JSON.stringify({ token, waba_id, phone_number_id }, null, 2));
  WA_TOKEN = token;
  PHONE_NUMBER_ID = phone_number_id;

  // 4. Sync contacts, then chat history (Meta allows this within 24h of connecting).
  for (const sync_type of ["smb_app_state_sync", "history"]) {
    try {
      await graph("POST", `${phone_number_id}/smb_app_data`, token, { messaging_product: "whatsapp", sync_type });
      console.log("Requested", sync_type);
    } catch (e) {
      console.error(e.message);
    }
  }
  return `Connected! The bot now answers on phone number ID ${phone_number_id}.\nSet SIGNUP_ENABLED back to 0 and restart the app.`;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function validSignature(raw, header) {
  if (!APP_SECRET) return true;
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex");
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

function onWebhook(body) {
  for (const entry of body.entry || [])
    for (const change of entry.changes || []) {
      const v = change.value || {};
      // A human replied from the WhatsApp Business app: step aside for that customer.
      if (change.field === "smb_message_echoes")
        for (const echo of v.message_echoes || []) {
          console.log("Human replied to", echo.to, "- pausing bot for", PAUSE_MINUTES, "min");
          pause(echo.to);
        }
      for (const msg of v.messages || []) handle(msg).catch((e) => console.error("Handler error", e));
    }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");

    // Meta checks the webhook once with a GET when you click "Verify and save".
    if (req.method === "GET" && url.pathname === "/webhook") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
      res.writeHead(ok ? 200 : 403);
      return res.end(ok ? url.searchParams.get("hub.challenge") : "Forbidden");
    }

    // Incoming messages, button taps and app echoes arrive as POSTs.
    if (req.method === "POST" && url.pathname === "/webhook") {
      const raw = await readBody(req);
      if (!validSignature(raw, req.headers["x-hub-signature-256"])) {
        console.warn("Rejected request with bad signature");
        res.writeHead(401);
        return res.end();
      }
      res.writeHead(200); // answer Meta right away, then work
      res.end();
      try { onWebhook(JSON.parse(raw)); } catch {}
      return;
    }

    if (SIGNUP_ENABLED && req.method === "GET" && url.pathname === "/signup") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(signupPage());
    }
    if (SIGNUP_ENABLED && req.method === "POST" && url.pathname === "/signup/complete") {
      try {
        const msg = await completeSignup(JSON.parse(await readBody(req)));
        res.writeHead(200);
        return res.end(msg);
      } catch (e) {
        console.error(e.message);
        res.writeHead(500);
        return res.end("Something went wrong: " + e.message);
      }
    }

    if (url.pathname === "/") { res.writeHead(200); return res.end("WhatsApp bot is running"); }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, () => console.log(`Listening on port ${PORT}`));
