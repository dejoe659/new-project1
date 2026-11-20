# PHASE 3: provider connections, delivery tracking, opt-outs and test mode

## What changed
- **Three independent provider adapters** (Gmail, Termii, WhatsApp Cloud API). Each reports whether a failure is worth retrying (network, rate limit) or permanent (bad number, rejected). Phone numbers are validated and converted to international form; invalid ones are skipped with a reason.
- **Delivery tracking.** Every send records the provider and the provider's message ID. A message only becomes `delivered` when the provider says so. WhatsApp and Termii webhooks update it, and a late "failed" can never undo a "delivered". Email stays `sent` because SMTP can only confirm that Gmail accepted it, not that it reached an inbox (bounces are not tracked).
- **Webhooks are verified.** WhatsApp: Meta's signature (HMAC-SHA256) with your app secret. Termii: HMAC-SHA512 signature or a shared token. Anything unsigned or wrongly signed is rejected. Retries are stored once. A status that arrives before the send was logged is kept and applied later.
- **Opt-out.** Replying STOP on WhatsApp switches WhatsApp off for that person immediately and sends a confirmation. Every email has an unsubscribe link (and the one-click header mail apps use). Opening the link only shows a confirmation button, so mail scanners cannot unsubscribe anyone.
- **WhatsApp 24-hour rule.** Messages we start use your approved template. Plain text is sent only inside the 24 hours after the person last messaged us.
- **Branded HTML emails** with a plain-text version.
- **Safe test mode (ON by default).** While on, messages go only to recipients you list. See below.
- All new endpoints live behind one function, `/api/comms/<name>`, which keeps the project well inside Vercel's function limit.

## IMPORTANT: sending is now locked until you open it
Test mode is ON in your database. Until you change it, nothing is sent to anyone, including the admin Follow-up tab (it will say "Test mode is ON"). Sending also now needs `SUPABASE_SERVICE_ROLE_KEY` in Vercel, because consent and test mode are read from the database.

**Allow only yourself (recommended first step)** - Supabase > SQL Editor:
```sql
update communication_settings
set value = '{"enabled": true, "recipients": ["2348012345678", "you@gmail.com"]}'
where key = 'test_mode';
```
Use your own phone (any format) and email. Changes take effect within 30 seconds.

**Go live for everyone** (only after your tests pass):
```sql
update communication_settings set value = '{"enabled": false, "recipients": []}' where key = 'test_mode';
```

## New Vercel settings
See `.env.example` for every name. Phase 3 adds: `SITE_URL`, `UNSUBSCRIBE_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, and (optional) `TERMII_WEBHOOK_SECRET`, `TERMII_WEBHOOK_TOKEN`, `TERMII_BASE_URL`, `WHATSAPP_GRAPH_VERSION`. Redeploy after adding them.

## Connect the webhooks
**WhatsApp** (Meta developer dashboard > your app > WhatsApp > Configuration):
1. Callback URL: `https://dcf-unn-site.vercel.app/api/comms/whatsapp-webhook`
2. Verify token: the same text you put in `WHATSAPP_VERIFY_TOKEN`. Click Verify and save.
3. Subscribe to the **messages** field (this carries both delivery statuses and replies).
4. `WHATSAPP_APP_SECRET` is under App settings > Basic > App secret.

**Termii** (Termii dashboard > webhook settings): URL `https://dcf-unn-site.vercel.app/api/comms/termii-webhook?token=YOUR_TOKEN`, with the same token in `TERMII_WEBHOOK_TOKEN`. Termii's report format is not confirmed against its own documentation yet, so after the first real report run the check below and tell me what it shows.

**Check that webhooks arrive** (SQL Editor):
```sql
select provider, event_type, signature_valid, processed_at, error, payload
from provider_webhooks order by received_at desc limit 10;
```
If nothing arrives, check Vercel > Logs for "webhook rejected" lines: they say whether the secret or the body encoding is the problem.

## Test checklist (do these in order, test mode ON with only your own contacts)
1. Admin > Follow-up: send yourself an SMS, a WhatsApp and an email. Open **Messages sent** and confirm each shows a provider and, after a minute, `delivered` for WhatsApp.
2. Click Unsubscribe in the email, press the button, and confirm `member_preferences.email_opt_in` is now false.
3. Reply STOP to the WhatsApp message and confirm you get the confirmation and a row appears in `contact_suppressions`.
4. To undo your own opt-outs while testing (super admin, SQL Editor): `delete from contact_suppressions where address in ('2348012345678','you@gmail.com');` and set the member's `*_opt_in` back to true in `member_preferences`.

## Limits you should know about
- **SMS replies:** Nigerian alphabetic sender IDs cannot receive replies, so "reply STOP" does not work on SMS. SMS opt-outs are recorded by an admin for now.
- **Email delivery:** "sent" means Gmail accepted it. Gmail also limits you to roughly 500 emails a day.
- **WhatsApp templates:** each template needs Meta's approval, and Meta decides its price category.

# PHASE 2: consent, queue and database foundation (AI Communication Centre)

Nothing in this phase sends new messages. It prepares the database and makes consent safe.

## What changed
- **Consent is per channel.** The join form now asks which of WhatsApp, SMS and Email the person agrees to (nothing is pre-ticked). The old single "I agree" box is gone. Ticking nothing is allowed and means no messages.
- **Existing members:** their earlier consent carries over to all three channels and is marked "legacy" so you can always tell it apart from new, per-channel consent.
- **Every send is checked** against the member's saved consent, a global opt-out, and a suppression list. If consent cannot be checked, nothing is sent.
- **New optional field:** hostel or residential address.
- **Security fix:** a public sign-up could set its own `review_status`. It can no longer.
- **The welcome message is now OFF until you set `AUTO_WELCOME=on`** in Vercel. Keep `AUTO_FOLLOWUP` and `AUTO_VISITOR_THANKS` off as well until testing is done.
- **New tables:** member_preferences, contact_suppressions, communication_settings, automation_rules (all six seeded as disabled), message_templates (7 starter templates), meeting_schedule (your four weekly meetings, editable), meeting_exceptions, campaigns, message_queue, message_approvals, provider_webhooks, admin_audit_logs. The existing `message_log` was extended, not duplicated.
- **Roles:** `super_admin` can do everything; `content_admin` can edit drafts, templates, the schedule and consent; `moderator` is read-only. Approving and sending will always be checked on the server (Phases 4 to 5).

## How to apply (in this order)
1. **Supabase > SQL Editor > New query.** Paste the whole of `supabase/migrations/20261119120000_phase2_communication_foundation.sql` and click Run. It is safe to run twice. You should see "Success".
2. **GitHub > Add file > Upload files.** Drag in the contents of the Phase 2 zip (keep the folders) and commit. Vercel redeploys.
3. **Check it worked.** Register a test member on `/contact#join`, tick only Email, then in Supabase run:
   `select m.full_name, p.whatsapp_opt_in, p.sms_opt_in, p.email_opt_in, p.consent_source from member_preferences p join members m on m.id = p.member_id order by m.created_at desc;`
   Your old members show `legacy_general_consent`; the new one shows only email = true.
4. **Admin > Registrations** now shows "May be contacted by" on each member.

## Tests
`npm install` then `npm test` runs 17 automated tests (consent, opt-out, fail-closed behaviour, registration, welcome switch). They use mocked providers, so nothing real is ever sent.

## Rollback
The migration only adds tables, columns and policies. To undo the registration change, redeploy the previous commit; the new tables can stay unused.

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
