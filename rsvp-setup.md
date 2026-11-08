# RSVPs → Google Sheet + WhatsApp (setup, about 10 minutes)

## 1. Get your WhatsApp keys (Sevo and Nina each do this on their own phone)
> **Note (8 Nov 2026):** CallMeBot's WhatsApp bot is currently full and not giving out new keys. Do steps 2–5 now with
> email alerts (NOTIFY_EMAILS); add the WhatsApp keys whenever CallMeBot reopens. No code change needed.

1. Open https://www.callmebot.com/blog/free-api-whatsapp-messages/ and add the bot number shown there to your contacts.
2. In WhatsApp, send it this exact message: `I allow callmebot to send me messages`
3. Wait for the reply. It contains your **API key**, a number like `123456`. (No reply in 2 minutes: try again after 24 hours.)
Keep the key; you'll paste it into the Sheet in step 4 (not into the chat).

## 2. Make the Sheet
1. Go to https://sheets.new and name it **Nina & Sevo — RSVPs**.
2. Menu **Extensions → Apps Script**.
3. Delete what's there, paste everything from `google-apps-script/Code.gs`, click **Save** (💾).

## 3. Create the tabs
1. In the Apps Script toolbar, pick **setup** in the function dropdown, click **Run**.
2. Google asks for permission: **Review permissions → your account → Advanced → Go to … (unsafe) → Allow**.
   (It says "unsafe" only because you wrote the script yourself and Google hasn't reviewed it.)
3. Back in the Sheet you now have two tabs: **RSVPs** (filled in automatically) and **Guests** (your guest list, with one example row).

## 4. Add the WhatsApp numbers and keys
In Apps Script: **Project Settings** (⚙️ on the left) → **Script properties** → **Add script property** for each row you have (skip the WhatsApp ones until you have keys):

| Property    | Value                                   |
|-------------|-----------------------------------------|
| SEVO_PHONE  | Sevo's number with country code, e.g. `+6281234567890` |
| SEVO_KEY    | Sevo's CallMeBot key                    |
| NINA_PHONE  | Nina's number with country code         |
| NINA_KEY    | Nina's CallMeBot key                    |
| NOTIFY_EMAILS | `you@example.com, nina@example.com` (email alerts; works today) |

Save, then go back to the editor, pick **testWhatsApp** and click **Run**. You should both get "✅ Nina & Sevo RSVP alerts are connected." (by WhatsApp and/or email).

## 5. Publish it
1. **Deploy → New deployment** → gear icon → **Web app**.
2. Execute as: **Me**. Who has access: **Anyone**.
3. **Deploy**, then copy the **Web app URL** (ends in `/exec`) and send it to Claude.
   It's not a password; it only accepts RSVPs and looks up guest names.

## Your guest list (Guests tab)
One row per invitation. The `id` is what goes after `#` in their link: `https://sevo-nina.vercel.app/#anna-ben`.

| Column        | Example                     | What it does |
|---------------|-----------------------------|--------------|
| id            | `anna-ben`                  | lowercase letters, numbers and dashes only |
| names         | `Anna and Ben`              | "For Anna and Ben" on the cover, and in the RSVP |
| seats         | `2`                         | pre-fills the number of guests |
| international | `yes` / `no`                | `no` hides the travel logistics |
| side          | `nina` / `sevo` / `both`    | for your own sorting |
| message       | (optional)                  | a personal line for that guest |
| ninaNote / sevoNote | (optional)            | replaces Nina's / Sevo's letter for that guest |

If someone replies twice, their row in **RSVPs** is updated (the *Replies* column counts how often) and you get a "✏️ RSVP updated" WhatsApp.
If a link id isn't on the guest list, the RSVP is still saved and the message says so.

**If you edit Code.gs later:** Deploy → Manage deployments → ✏️ → Version: *New version* → Deploy (the URL stays the same).
