-- After running admin-feedback.sql, promote YOUR EXISTING SOLENARY ACCOUNT.
-- Run only in Supabase > SQL Editor as the trusted project owner.
-- Replace YOUR_SIGN_IN_EMAIL_HERE with the email you use to log in to Solenary.
-- Do not paste this query into your website or commit a personalized copy to GitHub.

insert into public.solenary_admins (user_id)
select id from auth.users
where lower(email) = lower('YOUR_SIGN_IN_EMAIL_HERE')
on conflict (user_id) do nothing;

-- Verify: this should show exactly your account; if 0 rows, check the email.
select a.user_id, u.email, a.added_at
from public.solenary_admins a
join auth.users u on u.id = a.user_id;
