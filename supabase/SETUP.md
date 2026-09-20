# NRRU recycling activities — student account backend

The activity site remains a static GitHub Pages site. Account authentication is first-party and stored in the dedicated Supabase project `ejhlgroeoyvsyhntagvs`; Supabase Email Auth/SMTP is not required.

## Account model

- A participant registers with a **10-digit student ID** and a password of 6–72 characters.
- Passwords are never stored as plaintext. PostgreSQL `pgcrypto` stores a bcrypt hash only.
- Login returns a random 256-bit opaque session token. The browser stores the token locally; PostgreSQL stores only its SHA-256 hash.
- Sessions expire after 30 days.
- Five consecutive wrong-password attempts temporarily lock that account for five minutes.
- The student ID is unique and cannot create a second account.
- The designated admin student ID is held in `activity_private.admin_student_ids`. The initial allowlisted ID is `6940108219`.
- Private account, session and admin tables are not directly readable from the public API.

## Activity behavior

- The first saved display name, faculty and major are immutable.
- Evidence remains in the private `activity-proofs` Storage bucket.
- The browser cannot upload or read evidence directly. The `activity-files` Edge Function validates the custom session, then uses server credentials to upload proof, create short-lived admin proof URLs, or upload prize images.
- Evidence accepts JPEG, PNG or WebP up to 8 MiB.
- A submission is accepted only while the campaign is enabled and before its deadline.
- Approved submissions add exactly one point. Repeated review cannot add another point.
- Rejected submissions require a non-empty reason. The reason appears in that participant's private activity history; there is no email notification dependency.
- Public leaderboard output contains only display name, faculty, major and approved points.

## Deployment

1. Apply every SQL migration in `supabase/migrations/`. The student-auth migration rewires existing profile/submission ownership from `auth.users` to the first-party account table.
2. Deploy `supabase/functions/activity-files/index.ts` with JWT verification disabled. This is intentional because it validates the opaque `x-activity-session` token against PostgreSQL itself.
3. No SMTP, email redirect URL, Resend key, scheduler secret or Supabase Email Auth configuration is needed.
4. Set `activity-config.js` to `enabled: true` only after the migration and `activity-files` function are live.
5. Open `activity.html`, create a real test account, submit a test image, then sign in to `admin.html` using the allowlisted student ID and verify approve/reject flows.
6. Enable the campaign and set deadline/prize details from `admin.html`.

## Adding another admin

Run as a database owner:

```sql
insert into activity_private.admin_student_ids(student_id)
values ('0123456789')
on conflict do nothing;
```

Removing an ID from that table removes admin permission on the next session check. No password or session token should ever be added to Git.

## Validation

`npm ci && npm run build && npm run test:activities` validates registration/login, password/session behavior, immutable profiles, private submissions, admin authorization, review rules and leaderboard scoring using PGlite stubs for pgcrypto.

`node scripts/verify-activities-browser.mjs` validates login/register UX, first submission, returning profile lock, admin review, desktop/mobile layouts and closed-campaign behavior with mocked network calls.
