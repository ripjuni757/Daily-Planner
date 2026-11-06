# Solenary v7 — Your days, your rhythm.

A polished navy-and-white planning website with faint gold branding, private Supabase accounts, planning tools, recurring activities, school/work hours, team spaces, integrations handoffs, and a new admin-and-feedback workflow.

**Upgrade from Daymark v6.2 — no data reset.** The internal `daymark_tasks` and `daymark_spaces` table names are intentionally unchanged so all existing tasks, weekly hours, collaboration, and sessions are retained.

## Installation on your existing GitHub Pages repository

1. **Back up your personal calendar** in the current app (Settings > Your data > Download backup, or Tools > Download backup in an older release).
2. Download/extract the zip and upload **all individual files** into the root of `Daily-Planner` on GitHub. Replace old files; do not upload an enclosing folder or the zip itself.
3. Keep your Supabase project and existing SQL tables. The included `supabase-config.js` contains only the previously provided public URL and publishable key. Never put the `service_role`/secret key or your database password in this repository.
4. Under GitHub **Settings > Pages**, publish from `main` / `(root)`. After the latest Actions deployment completes, hard-refresh the browser.
5. Update your Supabase authentication Site URL and allowed redirects if you also change the **website domain** later. Merely changing the on-page brand from Daymark to Solenary does not require changing the current GitHub Pages URL.

## NEW: Feedback and admin setup (two SQL actions)

### A. Create the database objects

In **Supabase > SQL Editor > New query**, open `admin-feedback.sql`, copy **the entire file**, and click **Run**. It creates:

- `public.solenary_feedback`: a private, account-linked inbox. Any authenticated member can submit a message, but only an approved administrator can read and mark messages reviewed/resolved. A non-admin cannot list submissions (including other people's).
- `public.solenary_admins`: an owner-managed administrator allowlist. The website cannot add administrators.
- `public.solenary_am_i_admin()` and `public.solenary_admin_stats()`: restricted, authenticated functions. User count is calculated from Supabase Auth on the server, not by publishing your users' emails to the web.

Running **this SQL is required** for the new feedback box and Admin page to work. It does not alter the earlier Daymark tables or delete data.

### B. Grant your account administrator access

Open `SET-ADMIN.sql`, replace `YOUR_SIGN_IN_EMAIL_HERE` with **your existing Solenary login email**, then run it **only inside Supabase SQL Editor** as the trusted project owner. The resulting query should list your account's ID and email.

This is a privileged action. Do **not** commit your personalized SQL containing an email to GitHub, and do not create a public admin signup or put admin credentials into JavaScript.

Then sign into Solenary and reload. **Admin dashboard** should appear in the sidebar. You can also visit `admin.html`; the page blocks non-admin users, and Supabase policies guard the underlying data even if someone knows the URL. It shows total registered Supabase Auth accounts, number of feedback submissions, submissions waiting for review, and a manageable inbox of the 200 most recent messages.

### Privacy and security notes

- **Existing personal calendar data is unaffected**. The new page is a view of aggregate counts, not an unrestricted listing of user accounts.
- Feedback is tied to the authenticated sender's user ID. By design the admin can see the sender's user ID and message, but not their email address. Keep sensitive information out of feedback messages.
- Only the database controls admin privileges. Hiding the Admin link is *not* the security mechanism.
- This has not been independently penetration-tested. Before a public launch, review RLS policies and conduct two-account authorization tests. Basic server-side feedback throttling is included; add stronger anti-bot defenses and privacy/terms pages for a large user base.
- Underlying SQL functions with privileged access are placed in an unexposed `private` schema. The public functions use caller privileges and invoke only tightly-scoped, role-checking functions.

## Interface updates

- **Solenary** name and the existing circular gold mark on both pages, with a muted gold tagline, **Your days, your rhythm.**
- No Tools menu in the header. Access **Download/Restore backup, Import, and Export** through **Settings > Your data**. Calendar handoffs remain in Integrations.
- **New task → Weekly hours → Today** appears together in the left sidebar. Shared spaces and Integrations are also there, leaving Search, Week/Month, Settings, and Log out in the header.
- **Feedback** lives at the bottom of the planner. Submitting sends a private record directly to Supabase.
- Calendar type colors remain **blue tasks / red reminders / purple recurring activities**.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `app.js` | Main planner and calendar |
| `login.html`, `auth.js` | Authentication UI and logic |
| `solenary-mark.svg` | Local vector logo, editable |
| `feedback.js` | Authenticated feedback form and admin navigation |
| `admin.html`, `admin.css`, `admin.js` | Admin dashboard (server-authorized) |
| `supabase-config.js`, `supabase-client.js` | Existing browser connection with publishable key only |
| `connect.js`, `collaboration.sql` | Existing collaborative spaces and calendar handoffs |
| `admin-feedback.sql` | **Run once** for admin and feedback database setup |
| `SET-ADMIN.sql` | **Run after editing the email** to grant your first admin account |
| `supabase.sql` | Reference for the original private tasks table; do not rerun unnecessarily |
| `SECURITY.md` | Existing security review checklist |

## Limitations

- Calendar/Gmail/Outlook integrations are still manual links and exports, **not full bidirectional OAuth account connections**.
- Feedback appears after running the migration; if it has not run, the form shows a setup-related error on submission.
- GitHub Pages can serve this static website, but it cannot privately store backend keys or run secure server jobs by itself.
- The admin user count includes registered Supabase Auth accounts, including accounts that may not have confirmed email. It is not a count of active users.
