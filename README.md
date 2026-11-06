# DAYMARK COMPASS — GitHub Pages + Supabase (configured)

**Version 4: Daymark Compass, built on the existing Daymark layout. This download is ready to upload to GitHub Pages.** It includes your Daymark planner, login/signup page, CSS, JavaScript, Supabase connection file (with your **public** Project URL and publishable key), and a copy of the database setup SQL.

## A. Upload to GitHub

1. **Extract this ZIP on your computer.** Open the extracted folder.
2. Open your existing GitHub repository (for example, `Daily-Planner`) and select **Code**.
3. Use **Add file → Upload files** to upload the **individual files** from inside the extracted folder to the **root of the repository**, not a subfolder. Do **not** upload the ZIP itself.
4. Commit changes. Replace your old `index.html`, `style.css`, `README.md`, and any outdated app scripts with the new versions. The included `supabase-config.js` has your URL and publishable key already filled in; it can replace the old `supabase-config.js`. You may remove older `supabase-config.example.js` and `README` files to avoid confusion.
5. Go to **Settings → Pages**. Choose **Deploy from a branch**, `main`, `/ (root)` and save. If Pages is already enabled, wait for the latest deployment to complete in **Actions**.

The root of your GitHub repo must contain `index.html`, NOT just `README.md`, and not `Daymark-Complete-GitHub/index.html`. The default site is `https://YOUR-USERNAME.github.io/REPO/`. For example, if the repo is `Daily-Planner`, the login page is `https://YOUR-USERNAME.github.io/Daily-Planner/login.html`.

**A public GitHub repository is fine:** `supabase-config.js` contains a publishable key, not a secret. Its value is deliberately visible in the browser. **Never add your database password or Supabase service-role / `sb_secret_` keys to the website or GitHub.** Your database's Row Level Security (RLS) is what prevents users from reading others' tasks.

## B. Tell Supabase your real GitHub Pages address

Your Supabase project is already configured in `supabase-config.js`. You still need to allow the website's email confirmation / reset redirects:

1. In Supabase, open **Authentication → URL Configuration**.
2. Under **Site URL**, enter your **actual published** site URL (for example, `https://YOUR-USERNAME.github.io/Daily-Planner/`).
3. Under **Redirect URLs**, add these exact URLs (replace placeholders):
   - `https://YOUR-USERNAME.github.io/Daily-Planner/login.html`
   - `https://YOUR-USERNAME.github.io/Daily-Planner/`
4. Save. If you use a custom domain later, replace/add that domain here too.

The project must allow **Email** under Authentication → Sign In / Providers. You said that is already enabled.

## C. Database table and privacy protection

You said the `daymark_tasks` table already exists in Supabase Table Editor. If it was made using the SQL previously supplied, you can **skip** this step. Otherwise, open **SQL Editor** in that **same Supabase project**, paste `supabase.sql` and click **Run**. This creates the table if absent and safely replaces the four row-access policies without dropping any tasks.

**Do not turn off RLS.** The policies permit each authenticated user to see, insert, edit, and delete only rows where the `user_id` equals their own Supabase user ID.

## D. Test it

1. Open `https://YOUR-USERNAME.github.io/REPO/login.html`.
2. Create an account with a test email and password.
3. If email confirmation is enabled, confirm from the email link, then sign in.
4. Create a task and refresh. Verify it is still there.
5. Log out and log back in. Verify the task remains.
6. Sign in with a **different** account to make sure the first person's tasks do not appear.

If signup works but the planner says it can't load, check the `daymark_tasks` table, its grants, and RLS policies in Supabase. New tasks are stored in Supabase, not just your browser. Settings like preferred time format are local to each browser and each account.

## What's inside

- `index.html`: Personal weekly & monthly planner
- `login.html`: Sign in, sign up, password reset
- `style.css`: Navy/white, straight-edged professional design
- `app.js`: Tasks, notes, reminders, priorities, search, `.ics` / `.csv` import, calendar export & JSON backup, cloud sync
- `auth.js`: Email/password authentication
- `supabase-client.js`: Browser client for Supabase
- `supabase-config.js`: **Configured** Project URL + publishable key
- `supabase.sql`: Database table and RLS setup if needed
- `README.md`: This guide

## Limitations

- Reminder notifications work **only while the webpage is open** and browser notification permissions are granted; they are not push notifications.
- The app fetches cloud tasks on page load. To see edits made in a different browser, refresh the page; it doesn't use live realtime collaboration yet.
- The default Supabase mail delivery can have quotas and restrictions. Before opening registration widely, consider configuring custom SMTP, abuse protections, and rate limits.
- Test authentication before announcing the site publicly; browser/client code validation is not a substitute for an end-to-end test against your personal Supabase project.


## E. New in Daymark Compass (Version 4)

The original navy-and-white weekly/monthly calendar and existing log-in UI are preserved.

- **Daily Compass:** Set one objective and select up to three tasks for a date. Mark them complete directly on the dashboard.
- **Reality Check:** Compare estimated flexible-task workload with available time, after deducting fixed events, important reminders, and your customizable buffer. Overlapping timed items are flagged.
- **Deadline Runway:** Enter a deadline and desired study/work sessions. Daymark proposes time slots without overlapping existing scheduled items. Review then approve before tasks are saved.
- **Rebuild Week:** Reschedule overdue, unfinished flexible tasks into non-overlapping slots across the next 14 days. Only saves on approval; fixed events and reminders are never moved.
- **Weekly Reflection:** See completion rate, moved tasks, and estimated-versus-actual minutes (when entered), then save a private reflection.
- **ChatGPT handoff:** Generate a private, editable schedule summary and explicitly copy/paste it into ChatGPT. Optional notes are **off by default**. The website does **not** sign in with your ChatGPT account and does **not** automatically transmit or sync calendar data with ChatGPT.

**Cloud storage:** These planning features use one reserved row (`task_id=__daymark_compass_meta_v1__`) in your **existing** `daymark_tasks` table, protected by your existing row-level security rules. **You do not need to run additional SQL** if your current Daymark login and tasks already work. Tasks generated by these features are ordinary calendar items and sync the same way as your existing tasks.

**Backups:** JSON backups now include objectives, projects, priorities, and reflections. Restoring an older Daymark backup without Compass metadata resets these new fields; download a fresh backup before restoring. Importing external CSV/ICS calendar events does not overwrite Compass metadata.

**ChatGPT live integration (future work):** Real cross-app live access would require a separately hosted authenticated API/MCP server and an appropriate ChatGPT plugin. A static GitHub Pages site with a publishable Supabase browser key cannot safely expose other users' calendars to ChatGPT. Do not publicly expose access tokens, service-role keys, or private calendar feeds.

**Reality Check assumptions:** User-selected hours and buffer are per account. Tasks are treated as flexible work unless marked “Fixed commitment”; reminders are treated as fixed. All-day tasks use the entered estimated minutes. Estimates are not actual tracked work time. Deadline Runway avoids occupied calendar slots but does not solve every scheduling optimization problem.
