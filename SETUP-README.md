# DCF UNN update: Friday Prayer, member photos, follow-up messages

## What changed
- **Friday Prayer, 5:00 PM, Lawn Tennis** added to the Home and Services schedule and to every page footer.
- **Photo on registration.** New optional photo field on the join form. The photo is shrunk in the browser, stored in Supabase, shown on the admin Registrations card, and shown on the public Members page only for members who opted in and were approved. Members without a photo get a placeholder avatar (`assets/avatar.svg`).
- **Follow-up messages** by email, SMS (Termii) and WhatsApp (Meta Cloud API):
  1. *Welcome message* sent automatically when someone registers.
  2. *Admin tab:* on Follow-up, tick the members who missed the last two sessions, write a message, pick channels, send.
  3. *Weekly automatic reminder* (Sundays, 9 AM Lagos) to members who missed the last two sessions. **Off until you set `AUTO_FOLLOWUP=on`.**
  Only members who ticked "I agree to receive fellowship communications" are ever messaged. Visitors are not auto-messaged (the Call / WhatsApp links remain).

## Update 2: visitors and the Messages sent tab
- **Visitors can now be messaged.** On Admin > Follow-up, first-time visitors have a "Select to message" box. They receive SMS and WhatsApp only (visitors have no email). Only a leader can trigger it. Nothing is sent to visitors automatically. Visitors with no phone number are skipped.
- **Consent:** the check-in page now tells visitors that by checking in they agree the fellowship may contact them on that number.
- **Messages sent tab (admin only):** every email, SMS and WhatsApp with time, recipient, channel, type and result. Failed messages show the reason. You can filter by channel, result and type, and download a CSV. The database only lets signed-in administrators read this log.
- **Quick text buttons** ("We missed you", "Thank a visitor") fill in a ready message you can edit.

## Update 3: automatic visitor thank-you
When a visitor checks in, the page asks the server to send them one thank-you by SMS and WhatsApp (visitors have no email). **Off until you set `AUTO_VISITOR_THANKS=on` in Vercel.**
- Sent once per visit, only for a check-in made in the last 30 minutes, and capped at 60 a hour to protect your SMS credit.
- Registered members are not messaged. Only people who check in as visitors.
- Optional settings: `AUTO_VISITOR_CHANNELS` (default `sms,whatsapp`) and `VISITOR_THANKS_MESSAGE` (`{name}` = first name).
- It shows in the Messages sent tab as "Automatic (visitor thank-you)".
- No new database change is needed. Visitors still get the consent notice on the check-in page.

## Setup, in this order
1. **Supabase > SQL Editor:** run `supabase/migration-photo-and-followup.sql`, then `supabase/migration-2-visitors-and-log.sql`. Do this BEFORE step 2, otherwise the Members page will show nothing. (If you already ran the first file, run only the second.)
2. **GitHub:** open the repo > Add file > Upload files. Drag in the contents of this zip (keep the folders: `api`, `assets`, `supabase`) and commit to `main`. Vercel redeploys by itself.
3. **Vercel > Project > Settings > Environment Variables** (then redeploy):

| Name | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API > `service_role`. **Secret. Never put it in GitHub.** |
| `CRON_SECRET` | Any long random text (needed for the weekly job) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Already set for the notification emails; the same account sends to members |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` | From your Termii account. The sender ID must be approved by Termii first |
| `TERMII_CHANNEL` | Optional. Leave unset for `generic`. Use `dnd` if numbers on DND do not receive |
| `WHATSAPP_TOKEN` | Permanent token from a Meta System User |
| `WHATSAPP_PHONE_ID` | Phone number ID (Meta Developer dashboard > WhatsApp > API Setup) |
| `WHATSAPP_TEMPLATE` | Name of your approved template, e.g. `dcf_followup` |
| `WHATSAPP_LANG` | Optional, default `en` |
| `AUTO_FOLLOWUP` | `on` to switch the weekly reminder on. Leave unset while testing |
| `AUTO_CHANNELS` | Optional, default `sms,whatsapp,email` |
| `AUTO_MESSAGE`, `WELCOME_MESSAGE` | Optional custom wording. `{name}` becomes the first name |

   A channel with missing settings is simply skipped, so you can start with email only and add SMS and WhatsApp later.

4. **WhatsApp template** (Meta Business Manager > WhatsApp Manager > Message templates). WhatsApp only lets a business start a chat with an approved template.
   - Name: `dcf_followup`, language: English
   - Body (one variable): `Dunamis Campus Fellowship UNN: {{1}}`
   - Sample value for {{1}}: `Hello Chika, we missed you at fellowship. We pray all is well.`
   Meta decides the category and price. If it rejects the template, reword the fixed text around {{1}} and resubmit.

## Test it
1. Register yourself with a photo on `/contact#join`. You should get the welcome message, and the photo appears under Admin > Registrations.
2. Admin > Follow-up needs two sessions on the Attendance tab. Tick yourself, send a message, read the result line under the button.
3. Failures are explained in the Supabase table `message_log` (column `detail`).
4. Weekly job: Vercel > Project > Settings > Cron Jobs > Run, or `curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-SITE/api/followup-cron`.

## Notes
- Gmail allows about 500 emails a day. SMS and WhatsApp are charged per message by Termii and Meta.
- Keep SMS short (about 160 characters per segment).
- Delete a member in Admin and their photo file is deleted too.
- The repo also contains `admin (1).html`, `dcf-unn.zip` and `dcf-unn-update.zip`. They are not used by the site and can be deleted.
