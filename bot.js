// WhatsApp chat-options bot. No npm packages needed: plain Node 18+.
// Settings come from environment variables (see docker-compose.yml).
const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const WA_TOKEN = process.env.WA_TOKEN;               // access token from Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // the "From" number's ID
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;       // any secret word you choose; also typed into Meta
const APP_SECRET = process.env.APP_SECRET || "";     // optional: App settings > Basic > App secret
const GRAPH = process.env.GRAPH_URL || "https://graph.facebook.com/v25.0";

// ---- What the bot says. Edit freely. ----
const MENU = {
  type: "button",
  body: { text: "Hi! What would you like to do?" },
  action: {
    buttons: [
      { type: "reply", reply: { id: "book", title: "Book a haircut" } },
      { type: "reply", reply: { id: "prices", title: "See prices" } },
      { type: "reply", reply: { id: "hours", title: "Opening hours" } },
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
  prices: "Haircut: S/ 30\nBeard trim: S/ 15\nHaircut + beard: S/ 40",
  hours: "Mon-Sat 9:00-20:00\nSunday closed",
};

// Decide what to send back for one incoming message.
function handle(msg) {
  const from = msg.from;
  let choice = null;
  if (msg.type === "interactive") {
    const i = msg.interactive;
    choice = (i.button_reply || i.list_reply || {}).id;
  }

  if (choice === "book") return send(from, { type: "interactive", interactive: TIMES });
  if (choice && choice.startsWith("slot_")) {
    const time = choice.slice(5) + ":00";
    return send(from, { type: "text", text: { body: `Booked for tomorrow at ${time}. See you then! ✂️` } });
  }
  if (ANSWERS[choice]) return send(from, { type: "text", text: { body: ANSWERS[choice] } });

  // Anything else (a typed "hi", etc.) gets the menu.
  return send(from, { type: "interactive", interactive: MENU });
}

async function send(to, message) {
  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...message }),
  });
  const out = await res.text();
  if (!res.ok) console.error("Send failed", res.status, out);
  else console.log("Sent", message.type, "to", to);
}

function validSignature(raw, header) {
  if (!APP_SECRET) return true;
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex");
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");

    // Meta checks the webhook once with a GET when you click "Verify and save".
    if (req.method === "GET" && url.pathname === "/webhook") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
      res.writeHead(ok ? 200 : 403);
      return res.end(ok ? url.searchParams.get("hub.challenge") : "Forbidden");
    }

    // Incoming messages and button taps arrive as POSTs.
    if (req.method === "POST" && url.pathname === "/webhook") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        if (!validSignature(raw, req.headers["x-hub-signature-256"])) {
          console.warn("Rejected request with bad signature");
          res.writeHead(401);
          return res.end();
        }
        res.writeHead(200); // answer Meta right away, then work
        res.end();
        let body;
        try { body = JSON.parse(raw); } catch { return; }
        for (const entry of body.entry || [])
          for (const change of entry.changes || [])
            for (const msg of change.value?.messages || [])
              handle(msg).catch((e) => console.error("Handler error", e));
      });
      return;
    }

    if (url.pathname === "/") { res.writeHead(200); return res.end("WhatsApp bot is running"); }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, () => console.log(`Listening on port ${PORT}`));
