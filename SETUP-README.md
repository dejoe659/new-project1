# PHASE 5: sending approved messages

## How it works
- On the **Approvals** tab, an *Approved* message now has a **Send now** button (super admin only). Pressing it asks you to confirm, then sends in small batches while the page shows progress. **Continue sending** appears if it was interrupted.
- Sending first builds one queue row per person and channel. Only **approved members** in the chosen audience are included, and only if they agreed to that channel, are not opted out, have a valid phone or email, and are not on the opt-out list. Everyone left out is counted with the reason (see **History** on the message).
- Consent, the opt-out list and test mode are checked again at the moment of sending, so someone who opts out after queuing gets nothing.
- **Temporary failures** (network, busy provider) are retried after 5 minutes, 30 minutes, then 2 hours, up to 3 attempts. **Permanent failures** (bad number, rejected) are not retried and are marked failed.
- **A message is never sent twice.** Each row has a unique key, is claimed before sending, and a message that was mid-send when the server stopped is marked failed instead of being resent (it may already have gone out).
- A message ends as **Sent** if at least one person received it, or **Failed** if nobody did.
- **Scheduled messages** (approved with a future time) are sent by a daily job at about 07:00 UTC (08:00 Lagos). Vercel's free plan only allows daily jobs, so a message scheduled for 3 pm goes out the next morning.

## Needed in Vercel
`CRON_SECRET` (any long random text) for the daily job, and `UNSUBSCRIBE_SECRET` so emails carry a working unsubscribe link. Without `UNSUBSCRIBE_SECRET`, emails go out without that link.

## Before the first real send
Test mode must list your own phone and email, otherwise nothing is delivered. Send a message to yourself first, check it, then turn test mode off:
`update communication_settings set value = '{"enabled": false, "recipients": []}' where key = 'test_mode';`

## Known limits
- "Delivered" is tracked on the Messages sent tab (from provider reports), not on the queue row.
- A message to thousands of people is sent about 20 at a time from the page, so keep the page open until it finishes. Closing it is safe: press Continue sending later.

## Tests
`npm test` runs 92 tests, 19 of them for this phase.

# PHASE 4: approvals (nothing is sent yet)

## What changed
- **New admin tab: Approvals.** A leader writes an announcement once (email, SMS and/or WhatsApp wording), chooses the audience (everyone who agreed, or by level / department) and an optional send time, and saves it as a **draft**. They press **Submit for approval**. A super admin reads it and presses **Approve** or **Send back** (a reason is required). **History** shows who did what and when.
- **Nothing is sent in this phase.** Approved messages simply wait with the status *Approved* or *Approved and scheduled*. Sending, retries and scheduling arrive in Phase 5, and will still be blocked by test mode until you open it.
- **Roles are checked on the server**, never in the browser: `super_admin` can do everything; `content_admin` can write, submit and cancel but cannot approve; `moderator` can only view.
- **An approval covers exactly what the approver saw.** If anyone edits the message after the approver opened it, the approval is refused and they are asked to reload. Editing a message that is waiting for approval sends it back to draft.
- **Approved messages are locked.** They can only be cancelled, not edited.
- Every step is written to `message_approvals` (with before/after wording for edits) and to `admin_audit_logs`.

## How to apply
No new database change is needed (the tables came with Phase 2). Push to GitHub as usual; the only requirement is `SUPABASE_SERVICE_ROLE_KEY` in Vercel (the page says so if it is missing).

## Limits you should know about
- A super admin can approve their own draft. If you want a second person to always approve, say so and it is a small change.
- The history trail is saved right after the status change, not in the same database step. If saving the trail ever fails, it is reported in the Vercel logs.

## Tests
`npm test` now runs 72 tests, 18 of them for this phase (roles, version check, locking, validation).

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

## Phase 6: automatic "we missed you" messages, and better email delivery
- **Absence follow-up.** Every day at 08:00 Nigeria time the daily job looks at each service from the last 3 days (not today's). Every approved member who was not marked present, and who had already joined, gets their OWN message, addressed by first name and naming the service and date. One message per person per service, ever (a unique key blocks repeats). It uses the same consent, opt-out and test-mode checks as every other message. Switch it on/off with the `absent_followup` row in `automation_rules` (mode `automatic` = on, `disabled` = off; `channels` picks email/sms/whatsapp).
- The old weekly `/api/followup-cron` job was removed from `vercel.json` because this replaces it.
- **Email delivery.** Messages carry Reply-To, a plain-text version, and one-click unsubscribe headers. Email is capped at 400 a day (`EMAIL_DAILY_LIMIT`) and sent 5 at a time, because Gmail penalises bursts. Without your own domain, Gmail can still put some mail in spam: ask members to mark it "Not spam" or add the address to contacts. A custom domain with Resend is the real fix.

### Visitor welcome email (Phase 6b)
- The check-in page asks every new visitor for an email (compulsory); the notice under the form is their consent (migration-7).
- When a visitor checks in with an email, they get a personal welcome right away. The daily job re-checks the last 3 days as a safety net. One welcome per email address, ever, and every email has an unsubscribe link.
- Switch: `automation_rules` row `visitor_followup` (mode `automatic` + channel `email`). Run `supabase/migration-6-visitor-email.sql` (already applied to your project).
- How to see it working: Admin > Messages sent, category `visitor_followup`.

## Phase 8: Events and programmes
- **Public page `/events`:** upcoming programmes with poster, date, venue, spots left and a Register form; a past-programmes archive below. The homepage is untouched (it keeps its own events list).
- **Registration rules (enforced on the server):** valid name and phone, one registration per phone number per event, registration limit, closed/past events refused. Email is optional and needs a tick to agree to a reminder. The public can never read registrations.
- **Admin > Events:** add/edit events (date and time, venue, details, limit, poster), open/close registration, see registrations, tick who attended, download a CSV.
- **Reminders:** the daily job (08:00 Nigeria time) emails each registrant who gave an email once, when the event is within about 40 hours. Unsubscribe link included; test mode and the opt-out list are respected.
- Run `supabase/migration-8-events.sql` (already applied to your project).

## Phase 9: Prayer and counselling centre (/care)
- **Public page `/care`:** a private prayer request or counselling request. The person can stay anonymous. They get a one-time code (shown once, stored only as a hash) to check the status later. The status page shows only "Received / Being looked at / Prayed / Follow-up / Closed", never the content or the team's notes.
- **Who can read requests:** only signed-in administrators who a super administrator has added to the **care team** (Admin > Care). Roles: *counsellor* sees everything; *prayer team* sees only prayer requests marked for the prayer team. Counselling requests, and prayer requests marked "counsellors only", are visible to counsellors only. A super administrator is NOT automatically allowed to read requests.
- **Database:** the two tables (`care_requests`, `care_team`) have no public or normal-login access at all. Only the server reads them, after checking who is asking.
- **Audit:** opening, updating or deleting a request, and any change to the care team, is written to the audit log (never the content).
- **Safety:** at most 5 requests per hour from one address; spam trap field; the team gets an email saying a request arrived (never its content).
- **First step for you:** Admin > Care > add yourself (and your counsellors) to the care team. Run `supabase/migration-9-care.sql` (already applied).

## Phase 10: Sermons and resources
- **Public page `/sermons`:** search, filter by type and topic, featured items. Types: sermons, audio messages, video teachings, Bible study, discipleship, devotionals. Audio plays on the page, YouTube links are embedded, PDFs open in a new tab, devotional text can be read in place.
- **Admin > Sermons:** add or edit a resource, upload an audio file (MP3, M4A, WAV, OGG) or a PDF up to 50 MB, or paste a YouTube or other https link, or type written content. Feature, hide/publish, delete (deleting also removes the uploaded file). Only super and content administrators can change resources.
- **Video tip:** upload long videos to YouTube and paste the link here; the free storage limit is 50 MB per file.
- The public can read published items only (checked in the database). Run `supabase/migration-10-resources.sql` (already applied).

## Phase 11: Freshers' support and academic support
- Public pages `/freshers` and `/academic` list published library entries of type "Freshers' guide" / "Academic support".
- Manage them in Admin > Sermons: choose the type, add title, topic, short description, optional long text and optional link.
- They do not appear in the Sermons library. Both pages link to the private care team (`/care`) for personal help.
- Database change: `supabase/migration-11-guides.sql` (already applied to the live project).

## Phase 12: Faculty academic help and limited coordinators
- All 17 UNN faculties and their departments are in the database (`faculties`, `departments`). The department lists were entered from general knowledge, so check them: Admin > Academic help > "Faculties and departments" lets a super administrator add, remove or correct any name.
- Students use the form on `/academic`: faculty, department, course, level, problem and contact. They get a private code to check status. Requests are private and server-only.
- Faculty coordinators sign in at `/coordinator`. They are NOT in the `admins` table, so they have no database access and cannot open `/admin`. The server shows them only their own faculties.
- A super administrator creates them in Admin > Academic help: email, faculties, and two tick-boxes (may see contact details, may change status and notes). A temporary password is shown once. Access can be edited, switched off or removed at any time.
- Opening or changing a request is written to the audit log (never the problem text).
- Database change: `supabase/migration-12-academic.sql` (already applied to the live project).

## Phase 13: Overview statistics and homepage menu
- Admin > Overview shows members (total, waiting approval, by department and level), attendance for the last 8 weeks (members vs visitors), events, testimonies and messages. Super administrators also see counts for care and academic help (numbers only, never text).
- The homepage was not redesigned. Only its top menu gained the links to Events, Freshers, Academics, Sermons and Prayer.

## Phase 14: Security pass
Done in `supabase/migration-13-security.sql` and `vercel.json`:
- Trigger functions have a fixed search path; the preference trigger function can no longer be called over the API.
- Private tables (care, care team, academic requests, coordinators) have an explicit "deny everyone" policy. Only the server, using the secret key, reads them.
- Public tables (faculties, departments, resources) offer read-only access to the public; extra privileges were removed.
- Security headers on every page (no framing, no content sniffing, strict referrer, camera/microphone off, HTTPS only).
Left on purpose (the Supabase advisor still lists them, and they are needed):
- `check_in` and `check_in_visitor` are callable without sign-in because the public check-in page uses them. They only accept a valid service code.
- `is_admin`, `has_admin_role` and `admin_role` are used by the admin database rules. They only answer about the caller.
One thing only you can do: turn on **Leaked password protection** in Supabase (Authentication > Sign In / Providers > Password security). Supabase offers it on paid plans only.

## Passwords: easy to reset
- **Signed in:** "Change my password" on /admin and /coordinator (no email needed).
- **Forgot it:** "Forgot password?" on the sign-in page emails a reset link.
- **Locked out / no email arrives:** a super administrator opens Admin > Academic help > "Reset a password" (or "Reset password" on a coordinator's card), enters the email and gets a temporary password shown once. Recorded in the audit log.
- Supabase settings that make the emailed link reliable (dashboard only): add https://dcf-unn-site.vercel.app/** under Authentication > URL Configuration > Redirect URLs, and set Authentication > SMTP to the fellowship Gmail (smtp.gmail.com, port 465, app password) because the built-in sender allows only a few emails an hour.

## Phase 15: Alerts, weekly summary, backups
- A new academic help request emails the fellowship inbox and the active coordinators of that faculty. The email says only that a request is waiting. Student details are never emailed.
- Every Monday (08:00 Lagos, as part of the daily job) the fellowship inbox gets a summary of counts: new members, waiting approvals, check-ins, open care and academic requests, upcoming events, failed messages.
- Admin > Overview > "Download a backup" (super administrators): CSV files for members, attendance, events, event sign-ups and testimonies. Care and academic requests are never exported. Each download is audit-logged, and cells starting with = + - @ are neutralised so a spreadsheet will not run them.
