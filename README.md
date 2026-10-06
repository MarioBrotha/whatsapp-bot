# WhatsApp bot on ZimaOS

A small bot that answers WhatsApp messages with chat options:

- Any message (like "hi") gets the 3-button menu.
- **Book a haircut** opens a list of times. Picking one confirms the booking.
- **See prices** and **Opening hours** reply with text.

It's one file (`bot.js`) with no packages to install. It runs in the stock `node:22-alpine` Docker image. Edit the texts at the top of `bot.js` to change what it says.

## 1. Put the bot on the laptop

The bot lives in `/DATA/AppData/whatsapp-bot` on the laptop.

- **With git** (SSH into the laptop): `git clone https://github.com/MarioBrotha/whatsapp-bot /DATA/AppData/whatsapp-bot`. To update it later, run `git pull` in that folder, then restart the app.
- **Without git**: in the ZimaOS **Files** app, create `AppData/whatsapp-bot` and upload `bot.js` and `.env.example` into it.

## 2. Get a token that doesn't expire

The token from API Setup dies within 24 hours, which is no good for a server. Make a permanent one:

1. Go to business.facebook.com → **Settings** → **Users → System users** → **Add**. Pick any name and the role **Admin**.
2. Click **Assign assets**. Add your **Haircut** app (full control) and your **WhatsApp account** (full control).
3. Click **Generate token** and choose the Haircut app. For expiry, choose **Never**. Tick `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Copy the token somewhere safe. Meta shows it only once.

## 3. Add your secrets, then install the app

1. In `/DATA/AppData/whatsapp-bot`, copy `.env.example` to `.env` and fill it in:
   - `WA_TOKEN`: the permanent token from step 2.
   - `VERIFY_TOKEN`: any secret word you make up. You'll type the same word into Meta in step 5.
   - `APP_SECRET` (recommended): Meta app → **App settings → Basic → App secret**. With it set, the bot ignores requests that didn't come from Meta.

   `.env` is in `.gitignore`, so your secrets never reach GitHub.
2. In ZimaOS, open the **App Store**, click **+** (top right), then **Install a customized app**. Click **Import** and paste `docker-compose.yml`. If port `3077` is already used by another server, change it there.
3. Install. On the laptop, open `http://localhost:3077` (or the laptop's IP with port 3077). It should say **WhatsApp bot is running**.

## 4. Point your domain at it

Meta only talks to **https** addresses with a real certificate. Point a subdomain, for example `wa.yourdomain.com`, at port 3077, the same way your other servers are exposed:

- **Nginx Proxy Manager**: add a Proxy Host. Domain `wa.yourdomain.com`, forward to the laptop IP on port `3077`. On the SSL tab, request a Let's Encrypt certificate.
- **Cloudflare Tunnel**: add a public hostname `wa.yourdomain.com` pointing to the service `http://localhost:3077`.

Check that `https://wa.yourdomain.com` shows **WhatsApp bot is running** from your phone, with Wi-Fi off.

## 5. Connect it to Meta

1. In your Meta app, go to **WhatsApp → Configuration**.
2. Under Webhook, click **Edit**:
   - Callback URL: `https://wa.yourdomain.com/webhook`
   - Verify token: the same secret word as `VERIFY_TOKEN`
   - Click **Verify and save**.
3. Under **Webhook fields**, click **Manage** and subscribe to **messages**.
4. Send "hi" to the test number from your phone. The menu should come back by itself.

## If something's off

- See what the bot is doing: in ZimaOS open the app's **Logs**, or run `docker logs whatsapp-bot`.
- `Send failed 401`: the token is wrong or expired.
- **Verify and save** fails: the verify word doesn't match `VERIFY_TOKEN`, or the https address isn't reachable from outside.
- Nothing in the logs when you message: the **messages** webhook field isn't subscribed.
- `Rejected request with bad signature`: `APP_SECRET` is wrong. Fix it, or leave it empty.
- You change `bot.js` or `.env`: restart the app in ZimaOS.
