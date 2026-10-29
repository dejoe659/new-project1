# DCF UNN website
Static HTML/CSS/JS + Vercel serverless API (`/api`) + Supabase storage + Gmail notifications.
## Setup
1. Create a Supabase project, run `supabase/schema.sql` in the SQL editor.
2. Create a Gmail App Password for dunamiscampusfellowshipunn@gmail.com (needs 2-Step Verification).
3. In Vercel > Settings > Environment Variables add: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`.
4. Push this repo to GitHub, import it in Vercel, deploy.
## Moderating (until the admin dashboard exists)
Supabase Table Editor: set `testimonies.status` to `approved`; set `members.profile_approved` to true. Add events and gallery rows there too.
