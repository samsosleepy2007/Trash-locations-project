-- Owners designate administrator mailboxes without creating or confirming Auth users.
begin;
create table activity_private.admin_emails (
 email text primary key check(email=lower(trim(email)) and email ~ '^[^@[:space:]]+@nrru\.ac\.th$'),
 created_at timestamptz not null default now()
);
alter table activity_private.admin_emails enable row level security;
revoke all on activity_private.admin_emails from public,anon,authenticated;
create or replace function activity_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select activity_private.university_user() and (
  exists(select 1 from activity_private.admins where user_id=auth.uid())
  or exists(select 1 from auth.users u join activity_private.admin_emails a on a.email=lower(u.email)
            where u.id=auth.uid() and u.email_confirmed_at is not null)
 );
$$;
commit;
