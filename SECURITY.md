# Daymark security review and release checklist (v5)

## What is implemented

- **Supabase Auth** handles email/password accounts and sessions. Browser code contains only the project URL and **publishable** key.
- The existing `public.daymark_tasks` table has per-user Row Level Security. A signed-in user can read, write, edit and delete only rows whose `user_id` matches `auth.uid()`.
- New collaborative **space**, **membership** and **shared task** tables have explicit RLS policies and restricted grants. Space owners manage membership; any accepted member can edit shared tasks. Memberships are scoped by real Supabase user UUIDs. Personal tasks never become shared tasks automatically.
- `collaboration.sql` uses a `private` schema `SECURITY DEFINER` function with empty search path, minimal output (current user's membership IDs), and restricted execution privileges, to avoid RLS recursion. It is not exposed as an API RPC.
- Task titles and other displayed user-provided content are escaped or set via `textContent` rather than inserted as raw HTML. Related file links allow only HTTPS and open with `noopener,noreferrer`.
- Both pages add CSP meta and no-referrer settings. The Supabase browser dependency is version-pinned (update deliberately after testing).

## Do these tests **on your own Supabase project** before public launch

Use two test accounts A and B, plus an optional third account C. Test as normal users with their browser sessions; the Supabase Dashboard SQL editor runs with high privileges and cannot demonstrate client RLS enforcement by itself.

1. A creates a private task called "A PRIVATE". B must not be able to see or retrieve it. Verify through a separate browser/profile and (if you can) the REST API with B's normal access token, not with a service-role key.
2. B creates a task called "B PRIVATE". A must not see it. Changing a `user_id` in network requests should fail or return no data.
3. Anonymous/signed-out requests must not be able to select, insert, update or delete rows in either private or shared tables.
4. A creates a shared space. B initially cannot read its tasks. A adds B's exact account ID; B can then see and edit **shared** tasks but cannot see A's personal private tasks.
5. C, who was not added, must not access the shared space or tasks, even when given the space UUID.
6. B must not be able to add C to the space or change the `owner_id` of the space. Only A can change membership.
7. A removes B. B must then lose access to the space and shared tasks, including on manual refresh or attempted direct API calls.
8. Try a task title like `<img src=x onerror=alert(1)>` and ensure it displays as harmless text, not executable HTML.
9. Confirm all new-user signup flows, confirmation email redirects and reset-password routes. Do **not** disable email verification to work around a delivery failure.
10. Open DevTools Network and verify that no secret API keys, provider refresh tokens, or another user's tasks are returned to an unauthorized user.

## Operational security still needed

- Turn on Supabase email confirmation, authentication CAPTCHA/bot protection, leaked-password/strong-password protection if available, rate limits, MFA options and log monitoring. Consider throttling invites and shared task creation through a backend if the product grows.
- Back up the database, test restore, define incident response and users' data-deletion process. Remove abandoned public test accounts and revoke compromised credentials.
- For a public launch, obtain independent penetration testing or a responsible security review. No claim of being "unhackable" is warranted.
- GitHub Pages serves public static files and offers limited HTTP header control. Moving to a host with custom **HTTP** CSP, HSTS, `Permissions-Policy` and other security headers would improve defense in depth.
- Google/Microsoft OAuth integrations are not implemented; storing passwords or refresh tokens in static JavaScript is **not** an acceptable shortcut.

If an issue is found, disable signups or restrict exposure until the problem is fixed, review Supabase logs and rotate affected credentials/tokens. Never share your database password or service-role key in a public issue or chat.
