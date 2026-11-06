# Solenary — Your days, your rhythm.

Navy-and-gold personal planner with weekly and monthly calendars, recurring events, work/school hours, collaboration, feedback, and a private administration page.

## Admin panel improvements

Added user-account information and usage statistics to the administrator dashboard. The site displays its data collection practices in `privacy.html` and on the login and settings screens.

## Update an existing GitHub Pages site

1. Back up your existing calendar in **Settings → Your data → Download backup**.
2. Extract this ZIP; upload the **individual files** directly to the root of your GitHub repository, replacing matching filenames. Do not upload the ZIP itself or a surrounding directory.
3. Keep publishing from `main` / `(root)` under **Settings → Pages**. If the repository name or URL has changed, update the Supabase authentication Site URL and redirects.
4. In Supabase **SQL Editor**, run only **`usage-analytics.sql`** as a new query. Keep all your existing tables and the previous admin setup. You do not need to rerun `SET-ADMIN.sql`.
5. After the deployment succeeds, open `admin.html` while signed into your administrator account and choose **Users & Analytics**.

No existing tasks or feedback records should be deleted by this update. `supabase-config.js` contains only the URL and browser-safe publishable key; **never** add a Supabase service-role key, database password, or other private credential to GitHub.

Usage estimates begin after the new website and SQL are deployed; no historical usage can be reconstructed. Review the [privacy notice](privacy.html) and [security checklist](SECURITY.md) before inviting users. This is not a substitute for a security audit or legal review.
