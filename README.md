# Daymark Connect v5 — GitHub Pages + Supabase

This ZIP is ready to **extract and upload the individual files to your existing GitHub Pages repository root**. The classic Daymark planner and its original appearance are preserved. Sign-in and personal calendars still use the same Supabase project and `daymark_tasks` table.

## What's included

- Original weekly/monthly planner, tasks, reminders, Compass, Reality Check, Runway, Catch-Up and Weekly Reflection.
- **Shared spaces**: separate collaborative boards with shared task completion. Owners add collaborators using their Daymark account IDs, and may remove access. Your personal calendar is never shared as part of a space.
- **Integrations**: Google Calendar and Outlook calendar event handoffs, `.ics` exports/imports, Gmail/Outlook email drafts, Google Docs/Sheets/Drive and OneDrive link shortcuts, and optional HTTPS document links attached to individual private tasks. ChatGPT summary remains manual.
- **Security hardening**: separate private/shared tables with database RLS, restricted database privileges, immutable ownership columns, a private RLS helper, content-security and referrer policies, safer external links, 12-character minimum for new signups, and an explicit release checklist.

These are **not** live Gmail/Outlook/Drive OAuth integrations. The app does not read mail, automatically synchronize external calendars, or access Drive files. Real OAuth-based two-way sync needs a separate secure backend (for example Supabase Edge Functions), user consent, provider registrations and server-side token storage. **Never store provider client secrets or OAuth refresh tokens in GitHub Pages files or `localStorage`.**

## Upgrade an existing Daymark (important)

1. **Back up your planner:** Open Daymark → Tools → Download backup. (The migration below does not delete existing personal tasks, but backups are still wise.)
2. In GitHub `ripjuni757/Daily-Planner`, extract the ZIP and upload **the files individually to the repository root**, replacing files with the same names. Do not upload a containing folder or the ZIP. The included `supabase-config.js` already uses the public project URL and publishable key from your original Daymark setup. It contains no database secret.
3. **Required for shared spaces only:** In your Supabase project open **SQL Editor → New query**, copy the complete contents of `collaboration.sql`, then Run. This creates three new tables, policies and one private helper without changing your existing `daymark_tasks` rows. A 'table not found' message in Shared spaces means this step was not done.
4. Do **not** rerun `supabase.sql` unless your original personal-tasks table was never configured. You do not need to start a new Supabase project.
5. Check GitHub → Settings → Pages → Deploy from `main`, `/ (root)`; wait for the newest workflow in Actions to complete. Open `https://ripjuni757.github.io/Daily-Planner/` and hard-refresh.
6. Check Supabase → Authentication → URL Configuration. Site URL: `https://ripjuni757.github.io/Daily-Planner/`; allow redirect: `https://ripjuni757.github.io/Daily-Planner/login.html`.
7. **Before allowing public users**, read `SECURITY.md` and test the permission scenarios with two or three real accounts. We could not connect to or test your live Supabase project from here.

## Shared space walkthrough

1. Each collaborator creates a Daymark account and signs in.
2. They open **Shared spaces** → **Copy ID** and send the ID to the person creating a space. This is an account identifier, not a password.
3. Owner creates a space, selects it, enters the other person's account ID and clicks **Add member**.
4. That person opens Shared spaces, refreshes, chooses the space and can add/complete shared tasks. You can remove them at any time. Changes are fetched when opening or pressing **Refresh**; real-time push updates are not yet configured.
5. Shared-space tasks live in the shared-space panel, **not** inside someone's private week grid. Individual users' personal calendars are never merged or revealed.

## Security expectations

- Static GitHub Pages files are public. Only use the **Supabase publishable key** in `supabase-config.js`, never `service_role`, a secret key, database passwords, Gmail credentials, Microsoft client secrets, or tokens.
- The RLS policies are the real data boundary, not the JavaScript UI. Test all deny cases (nonmember, revoked member, signed-out browser) directly.
- Security is a process: these changes improve safeguards but do **not** certify Daymark as secure or audited, and this version has not undergone a third-party penetration test.
- Keep Supabase **email confirmation enabled** for public signup. In Authentication settings consider CAPTCHA / bot protection, rate limits, stronger passwords, MFA and monitoring. Those settings cannot be safely enforced just by HTML.
- GitHub Pages cannot add custom HTTP response security headers on demand. The package uses an HTML Content-Security-Policy, which is useful but not a full substitute for server-side headers.

## Included files

`index.html`, `login.html`, `style.css`, `app.js`, `auth.js`, `supabase-client.js`, `supabase-config.js`, `supabase.sql` (existing personal-task setup), `collaboration.sql` (**new database migration**), `connect.js`, `SECURITY.md`, `README.md`.

## What's still required for production-scale integrations

- Register Google Cloud and Microsoft Entra OAuth apps with explicit scopes.
- Build an authenticated authorization-code + PKCE callback and refresh/revoke pipeline in backend functions.
- Encrypt integration tokens and store server-side with per-user authorization, never in browser-visible storage.
- Respect Gmail/Google and Microsoft consent, verification and usage rules, plus deletion/export requirements.
- Add webhook/polling workers, conflict handling, logging, throttling and opt-in email notifications.

See `SECURITY.md` for a test plan and limits.
