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
- Evidence and prize images are uploaded by the `activity-files` Edge Function to ImgBB. The browser never receives the ImgBB API key.
- ImgBB is retried up to three times for transient 429/5xx/maintenance responses. If it remains unavailable, proofs fall back to private `activity-proofs` Storage and prize images fall back to the public `activity-prizes` bucket.
- Proof fallback values are stored as `storage://activity-proofs/...` references and are converted to short-lived signed URLs only for admins. Prize fallback values use the project's public Storage URL.
- PostgreSQL stores ImgBB `data.url` direct image URLs (`https://i.ibb.co/...`) for evidence/prize images.
- The ImgBB API key is stored only in `activity_private.integration_secrets`; never commit it to GitHub or `activity-config.js`.
- Evidence accepts JPEG, PNG or WebP up to 8 MiB.
- A submission is accepted only while the campaign is enabled and before its deadline. If an admin enables a brand-new campaign without an end time, the backend defaults the deadline to seven days in the future.
- Approved submissions add exactly one point. Repeated review cannot add another point.
- Rejected submissions require a non-empty reason. The reason appears in that participant's private activity history; there is no email notification dependency.
- Public leaderboard output contains only display name, faculty, major and approved points.

## Deployment

1. Apply every SQL migration in `supabase/migrations/`. The student-auth migration rewires existing profile/submission ownership from `auth.users` to the first-party account table.
2. Store the ImgBB API key in `activity_private.integration_secrets` under the name `imgbb_api_key`. Do not put the key in frontend files or Git history.
3. Deploy `supabase/functions/activity-files/index.ts` with JWT verification disabled. It validates the opaque `x-activity-session` token, obtains the ImgBB key using a service-role-only RPC, uploads with ImgBB API v1, and returns only the direct image URL.
4. No SMTP, email redirect URL, Resend key, scheduler secret or Supabase Email Auth configuration is needed.
5. Set `activity-config.js` to `enabled: true` only after the migration, ImgBB key and `activity-files` function are live.
6. Open `activity.html`, create a real test account, submit a test image, then sign in to `admin.html` using the allowlisted student ID and verify approve/reject flows.
7. Enable the campaign and set deadline/prize details from `admin.html`. A missing first deadline is prefilled to seven days from the current time.

## Adding another admin

Run as a database owner:

```sql
insert into activity_private.admin_student_ids(student_id)
values ('0123456789')
on conflict do nothing;
```

Removing an ID from that table removes admin permission on the next session check. No password or session token should ever be added to Git.

## Validation

`npm ci && npm run build && npm run test:activities` validates registration/login, password/session behavior, private ImgBB secret access, direct-image URL validation, automatic campaign deadline, immutable profiles, admin authorization, review rules and leaderboard scoring using PGlite stubs for pgcrypto.

`node scripts/verify-activities-browser.mjs` validates login/register UX, first submission, returning profile lock, admin review, desktop/mobile layouts and closed-campaign behavior with mocked network calls.
