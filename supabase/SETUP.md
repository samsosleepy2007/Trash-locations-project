# NRRU recycling activities — activation guide

The map remains a static GitHub Pages site. Activities use a **dedicated** Supabase project for verified email authentication, PostgreSQL/RLS and private evidence storage, plus Resend for rejection messages. `activity-config.js` intentionally disables sign-in and submission until these services are configured. Empty rankings and prize placeholders contain no fabricated participants or rewards.

## Provision and configure

1. Create a separate Supabase project after confirming the organization and price. Do not reuse the unrelated VoiceCraft database. Apply `migrations/20260920182219_recycling_activities.sql` with the Supabase CLI (`supabase link --project-ref PROJECT_REF`, then `supabase db push`). No activity schema should be exposed other than `public`; keep `activity_private` out of API exposed schemas.
2. Enable email authentication with email confirmation **on**. Configure custom SMTP with a verified sender; Supabase's default mail service does not deliver to arbitrary student addresses. Set Site URL to `https://samsosleepy2007.github.io/Trash-locations-project/` and add exact redirect URLs ending in `/activity.html` and `/admin.html`. The default magic-link email works; if using OTP instead, include the token in the email template. Configure Auth rate limits appropriate to the campus and verify a real mailbox can receive and complete sign-in. Database authorization independently requires an actual confirmed `@nrru.ac.th` email, not editable metadata. Restrict signups to the campus domain via an Auth before-user-created hook if desired to also prevent off-domain Auth accounts; they already cannot submit or read protected data.
3. Have the designated administrator sign in once with their university mailbox. A database owner then grants the role, substituting the **confirmed real administrator address**:

```sql
insert into activity_private.admins(user_id)
select id from auth.users
where lower(email) = 'REPLACE_WITH_ADMIN@nrru.ac.th'
  and email_confirmed_at is not null
on conflict do nothing;
```

No administrator is seeded, and users cannot grant themselves this role. Admin access currently requires a university email too.

4. Configure Edge Function secrets through the Supabase dashboard or a local ignored environment file, never in frontend JavaScript or git:
   - `RESEND_API_KEY`: key for a verified sender domain.
   - `ACTIVITY_MAIL_FROM`: verified sender, e.g. `NRRU Green Campus <activities@YOUR_VERIFIED_DOMAIN>`.
   - `ACTIVITY_SITE_ORIGIN`: `https://samsosleepy2007.github.io` (origin only).
   - `ACTIVITY_SCHEDULER_SECRET`: a newly generated high-entropy random secret.
   - Supabase automatically provides its own URL and server credentials to the function.

   Deploy `supabase functions deploy activity-mailer`. `verify_jwt = false` is deliberate: the function verifies a caller's token against Auth and the database admin allowlist, or checks a private scheduler token. It does not trust the client UI, unsigned claims or an anonymous API key.

5. Schedule the function every minute using Supabase Cron + pg_net. Enable the `pg_cron`, `pg_net`, and Vault extensions through the dashboard. Store secrets in Vault named `activity_project_url` (the project HTTPS URL) and `activity_scheduler_secret` (same secret as the function). Then apply `schedule-mail.sql`. Inspect Cron and Edge logs and send a real rejection only to a consenting test participant. The admin page also provides a manual queue-processing button.
6. Set `supabaseUrl` and `publishableKey` in `activity-config.js` and enable the flag only after Auth, RLS, private storage and mail have passed a live acceptance test. Only a public/publishable key goes here; never the service-role key. Upload the prize image and set the end date/time through `admin.html`; all entered dates are interpreted in Asia/Bangkok (UTC+7). Enable the campaign there to start receiving entries.

## Behavior and invariants

- The first saved display name, faculty and major are immutable, including when an image upload subsequently fails. Clients may read their own profile; only a privileged server function can create it. A trigger prevents subsequent mutation.
- Submissions accept private JPEG, PNG or WebP evidence up to 8 MiB. The photo path belongs to the current student and submission UUID. Evidence referenced by a submitted record cannot be overwritten or deleted. Admin photos use 5-minute signed URLs.
- The database rejects new submissions after the deadline, independent of the device clock. Client retries use the same UUID. A completed request remains idempotent even if retried after closing.
- Admin review locks each row. An approval counts as exactly one point; repeated approval does not add points. Opposite decisions after review are rejected. Public rankings expose only name, faculty, major and approved points. Email addresses and evidence stay private. Ties use earliest approval, profile creation, then stable UUID. Rank output is limited to 100.
- Rejection atomically adds one outbox notification with the student's current email. A service-only worker leases five messages at a time. Resend idempotency keys prevent repeated delivery within its 24-hour window; automatic retries stop at six attempts or 23 hours. Admins see sent/pending/failed counts. A database owner must investigate failed delivery rather than blindly replay outside that window. “Sent” means accepted by the provider, not confirmed delivery; inspect provider logs for bounces.
- Admin queue shows the oldest 200 pending records and latest 50 reviewed records. Processing pending items reveals the next batch. Notification status shows the latest 200 notifications.
- This version has one campaign and no reset/archive interface. Changing dates reopens the same campaign and preserves points. New seasons need a deliberate migration rather than silently clearing scores.

## Validation

`npm ci && npm run build && npm run test:activities` runs a real PostgreSQL engine (PGlite) against the migration, with Auth and Storage schemas stubbed. It checks university confirmation, immutable profiles, RLS, private proof access/deletion, admin authorization, idempotent scoring and submission, outbox permissions/leases and deadlines.

`node scripts/verify-activities-browser.mjs` runs Chromium UI flows with **mocked Auth/Storage/API responses** and writes screenshots. It sends no real emails. GitHub Actions also reruns the existing map/gallery checks. These are not a substitute for the live Supabase/SMTP/Resend activation checks above.

References: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [private Storage](https://supabase.com/docs/guides/storage/serving/downloads), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Provisioned deployment

Project: `ejhlgroeoyvsyhntagvs` — NRRU Green Campus Activities, Singapore. Both migrations have been applied and `activity-mailer` version 1 deployed. The designated administrator mailbox is stored only in `activity_private.admin_emails`; it is not an auto-confirmed Auth account. A matching, genuinely confirmed university mailbox receives admin rights. Clients have no access to modify this allowlist.

Pending activation: dashboard login, custom SMTP/verified email sender, exact Auth redirect URLs, mailer secrets and schedule, then a real consenting mailbox acceptance test. The frontend flag remains off until these are ready. To designate a further administrator, a database owner may insert the lowercased email into `activity_private.admin_emails`. Never add unconfirmed Auth identities or disable email confirmation to work around missing SMTP.
