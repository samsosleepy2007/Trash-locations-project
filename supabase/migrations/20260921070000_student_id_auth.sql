-- Replace Supabase email authentication with first-party student ID + password sessions.
begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists activity_private.accounts (
 id uuid primary key default gen_random_uuid(),
 student_id text not null unique check(student_id ~ '^[0-9]{10}$'),
 password_hash text not null,
 failed_attempts integer not null default 0 check(failed_attempts >= 0),
 locked_until timestamptz,
 created_at timestamptz not null default now(),
 last_login_at timestamptz
);
alter table activity_private.accounts enable row level security;
revoke all on activity_private.accounts from public,anon,authenticated;

create table if not exists activity_private.sessions (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references activity_private.accounts(id) on delete cascade,
 token_hash text not null unique,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 last_used_at timestamptz not null default now()
);
create index if not exists activity_sessions_account on activity_private.sessions(account_id,expires_at desc);
create index if not exists activity_sessions_expiry on activity_private.sessions(expires_at);
alter table activity_private.sessions enable row level security;
revoke all on activity_private.sessions from public,anon,authenticated;

create table if not exists activity_private.admin_student_ids (
 student_id text primary key check(student_id ~ '^[0-9]{10}$'),
 created_at timestamptz not null default now()
);
insert into activity_private.admin_student_ids(student_id) values('6940108219') on conflict do nothing;
alter table activity_private.admin_student_ids enable row level security;
revoke all on activity_private.admin_student_ids from public,anon,authenticated;

alter table public.activity_profiles drop constraint if exists activity_profiles_user_id_fkey;
alter table public.activity_profiles
 add constraint activity_profiles_user_id_fkey foreign key(user_id) references activity_private.accounts(id);

alter table public.activity_submissions drop constraint if exists activity_submissions_reviewed_by_fkey;
alter table public.activity_submissions
 add constraint activity_submissions_reviewed_by_fkey foreign key(reviewed_by) references activity_private.accounts(id);

drop policy if exists profile_self_or_admin on public.activity_profiles;
drop policy if exists submissions_self_or_admin on public.activity_submissions;
revoke all on public.activity_profiles,public.activity_submissions from anon,authenticated;

drop policy if exists activity_proofs_insert on storage.objects;
drop policy if exists activity_proofs_read on storage.objects;
drop policy if exists activity_proofs_orphan_delete on storage.objects;
drop policy if exists activity_prizes_insert on storage.objects;
drop policy if exists activity_prizes_admin_read on storage.objects;

create or replace function activity_private.student_id_ok(p_student_id text) returns boolean
language sql immutable set search_path='' as $$
 select trim(coalesce(p_student_id,'')) ~ '^[0-9]{10}$';
$$;

create or replace function activity_private.password_ok(p_password text) returns boolean
language sql immutable set search_path='' as $$
 select char_length(coalesce(p_password,'')) between 6 and 72;
$$;

create or replace function activity_private.account_from_session(p_session text) returns uuid
language sql stable security definer set search_path='' as $$
 select s.account_id
 from activity_private.sessions s
 where s.token_hash=encode(extensions.digest(coalesce(p_session,''),'sha256'),'hex')
   and s.expires_at>clock_timestamp()
 limit 1;
$$;

create or replace function activity_private.is_admin_account(p_account uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_account is not null and exists(
   select 1
   from activity_private.accounts a
   join activity_private.admin_student_ids x on x.student_id=a.student_id
   where a.id=p_account
 );
$$;

create or replace function activity_private.issue_session(p_account uuid) returns text
language plpgsql security definer set search_path='' as $$
declare raw_token text;
begin
 delete from activity_private.sessions where expires_at<=clock_timestamp();
 raw_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into activity_private.sessions(account_id,token_hash,expires_at)
 values(p_account,encode(extensions.digest(raw_token,'sha256'),'hex'),clock_timestamp()+interval '30 days');
 return raw_token;
end $$;

create or replace function activity_private.register(p_student_id text,p_password text)
returns table(session_token text,user_id uuid,student_id text,is_admin boolean)
language plpgsql security definer set search_path='' as $$
declare
 sid text:=trim(coalesce(p_student_id,''));
 account_id uuid;
begin
 if not activity_private.student_id_ok(sid) then raise exception 'INVALID_STUDENT_ID'; end if;
 if not activity_private.password_ok(p_password) then raise exception 'WEAK_PASSWORD'; end if;
 begin
   insert into activity_private.accounts(student_id,password_hash)
   values(sid,extensions.crypt(p_password,extensions.gen_salt('bf',10)))
   returning id into account_id;
 exception when unique_violation then
   raise exception 'STUDENT_ID_EXISTS';
 end;
 return query
 select activity_private.issue_session(account_id),account_id,sid,activity_private.is_admin_account(account_id);
end $$;

create or replace function activity_private.login(p_student_id text,p_password text)
returns table(session_token text,user_id uuid,student_id text,is_admin boolean)
language plpgsql security definer set search_path='' as $$
declare
 sid text:=trim(coalesce(p_student_id,''));
 a activity_private.accounts;
begin
 if not activity_private.student_id_ok(sid) then return; end if;

 select x.* into a
 from activity_private.accounts x
 where x.student_id=sid
 for update;

 if not found then return; end if;
 if a.locked_until is not null and a.locked_until>clock_timestamp() then return; end if;

 if extensions.crypt(coalesce(p_password,''),a.password_hash)<>a.password_hash then
   update activity_private.accounts
   set failed_attempts=failed_attempts+1,
       locked_until=case when failed_attempts+1>=5 then clock_timestamp()+interval '5 minutes' else null end
   where id=a.id;
   return;
 end if;

 update activity_private.accounts
 set failed_attempts=0,locked_until=null,last_login_at=clock_timestamp()
 where id=a.id;

 return query
 select activity_private.issue_session(a.id),a.id,a.student_id,activity_private.is_admin_account(a.id);
end $$;

create or replace function activity_private.logout(p_session text) returns void
language sql security definer set search_path='' as $$
 delete from activity_private.sessions
 where token_hash=encode(extensions.digest(coalesce(p_session,''),'sha256'),'hex');
$$;

create or replace function activity_private.me(p_session text)
returns table(user_id uuid,student_id text,is_admin boolean)
language sql stable security definer set search_path='' as $$
 select a.id,a.student_id,activity_private.is_admin_account(a.id)
 from activity_private.accounts a
 where a.id=activity_private.account_from_session(p_session);
$$;

create or replace function activity_private.own_profile(p_session text) returns setof public.activity_profiles
language plpgsql stable security definer set search_path='' as $$
declare account_id uuid:=activity_private.account_from_session(p_session);
begin
 if account_id is null then raise exception 'SESSION_REQUIRED'; end if;
 return query select p.* from public.activity_profiles p where p.user_id=account_id;
end $$;

create or replace function activity_private.own_history(p_session text)
returns table(id uuid,status text,submitted_at timestamptz,rejection_note text,photo_path text)
language plpgsql stable security definer set search_path='' as $$
declare account_id uuid:=activity_private.account_from_session(p_session);
begin
 if account_id is null then raise exception 'SESSION_REQUIRED'; end if;
 return query
 select s.id,s.status,s.submitted_at,s.rejection_note,s.photo_path
 from public.activity_submissions s
 where s.user_id=account_id
 order by s.submitted_at desc
 limit 50;
end $$;

create or replace function activity_private.save_profile(p_session text,p_name text,p_faculty text,p_major text)
returns public.activity_profiles
language plpgsql security definer set search_path='' as $$
declare
 account_id uuid:=activity_private.account_from_session(p_session);
 result public.activity_profiles;
begin
 if account_id is null then raise exception 'SESSION_REQUIRED'; end if;

 insert into public.activity_profiles(user_id,display_name,faculty,major)
 values(account_id,trim(p_name),trim(p_faculty),trim(p_major))
 on conflict(user_id) do nothing;

 select * into result from public.activity_profiles where user_id=account_id;
 if result.display_name<>trim(p_name)
    or result.faculty<>trim(p_faculty)
    or result.major<>trim(p_major) then
   raise exception 'PROFILE_LOCKED';
 end if;
 return result;
end $$;

create or replace function activity_private.submit(p_session text,p_id uuid,p_campaign uuid,p_photo text) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 account_id uuid:=activity_private.account_from_session(p_session);
 campaign public.activity_campaigns;
 existing public.activity_submissions;
 object_id uuid;
begin
 if account_id is null then raise exception 'SESSION_REQUIRED'; end if;
 if not exists(select 1 from public.activity_profiles where user_id=account_id) then raise exception 'PROFILE_REQUIRED'; end if;

 select * into existing from public.activity_submissions where id=p_id;
 if found then
   if existing.user_id=account_id and existing.photo_path=p_photo and existing.campaign_id=p_campaign then return p_id; end if;
   raise exception 'SUBMISSION_CONFLICT';
 end if;

 select * into campaign from public.activity_campaigns where id=p_campaign for share;
 if not found or not campaign.enabled or campaign.ends_at is null or clock_timestamp()>=campaign.ends_at then
   raise exception 'CAMPAIGN_CLOSED';
 end if;

 if p_photo !~ ('^'||account_id::text||'/'||p_id::text||'\.(jpg|jpeg|png|webp)$') then
   raise exception 'INVALID_PHOTO_PATH';
 end if;

 select id into object_id
 from storage.objects
 where bucket_id='activity-proofs' and name=p_photo
 for share;
 if not found then raise exception 'PHOTO_REQUIRED'; end if;

 insert into public.activity_submissions(id,campaign_id,user_id,photo_path,proof_object_id)
 values(p_id,p_campaign,account_id,p_photo,object_id);
 return p_id;
end $$;

create or replace function activity_private.admin_queue(p_session text)
returns table(
 id uuid,status text,photo_path text,submitted_at timestamptz,reviewed_at timestamptz,
 rejection_note text,display_name text,faculty text,major text
)
language plpgsql stable security definer set search_path='' as $$
declare account_id uuid:=activity_private.account_from_session(p_session);
begin
 if not activity_private.is_admin_account(account_id) then raise exception 'ADMIN_REQUIRED'; end if;

 return query
 select q.id,q.status,q.photo_path,q.submitted_at,q.reviewed_at,q.rejection_note,q.display_name,q.faculty,q.major
 from (
   (select s.id,s.status,s.photo_path,s.submitted_at,s.reviewed_at,s.rejection_note,p.display_name,p.faculty,p.major,0 as bucket
    from public.activity_submissions s
    join public.activity_profiles p on p.user_id=s.user_id
    where s.status='pending'
    order by s.submitted_at asc
    limit 200)
   union all
   (select s.id,s.status,s.photo_path,s.submitted_at,s.reviewed_at,s.rejection_note,p.display_name,p.faculty,p.major,1 as bucket
    from public.activity_submissions s
    join public.activity_profiles p on p.user_id=s.user_id
    where s.status<>'pending'
    order by s.reviewed_at desc
    limit 50)
 ) q
 order by q.bucket,q.submitted_at;
end $$;

create or replace function activity_private.review(p_session text,p_id uuid,p_decision text,p_note text default '') returns text
language plpgsql security definer set search_path='' as $$
declare
 account_id uuid:=activity_private.account_from_session(p_session);
 item public.activity_submissions;
 normalized_note text;
begin
 if not activity_private.is_admin_account(account_id) then raise exception 'ADMIN_REQUIRED'; end if;
 if p_decision not in ('approved','rejected') or p_decision is null then raise exception 'INVALID_DECISION'; end if;

 select * into item from public.activity_submissions where id=p_id for update;
 if not found then raise exception 'SUBMISSION_NOT_FOUND'; end if;
 if item.status=p_decision then return item.status; end if;
 if item.status<>'pending' then raise exception 'ALREADY_REVIEWED'; end if;

 normalized_note:=trim(coalesce(p_note,''));
 if p_decision='rejected' and normalized_note='' then raise exception 'REJECTION_REASON_REQUIRED'; end if;

 update public.activity_submissions
 set status=p_decision,
     reviewed_at=clock_timestamp(),
     reviewed_by=account_id,
     rejection_note=case when p_decision='rejected' then normalized_note else null end
 where id=p_id;

 return p_decision;
end $$;

create or replace function activity_private.settings(
 p_session text,p_title text,p_enabled boolean,p_ends timestamptz,p_caption text,p_prize text
) returns public.activity_campaigns
language plpgsql security definer set search_path='' as $$
declare
 account_id uuid:=activity_private.account_from_session(p_session);
 result public.activity_campaigns;
begin
 if not activity_private.is_admin_account(account_id) then raise exception 'ADMIN_REQUIRED'; end if;
 if p_enabled and (p_ends is null or p_ends<=clock_timestamp()) then raise exception 'END_TIME_MUST_BE_FUTURE'; end if;
 if p_prize is not null and not exists(
   select 1 from storage.objects where bucket_id='activity-prizes' and name=p_prize
 ) then raise exception 'PRIZE_IMAGE_NOT_FOUND'; end if;

 update public.activity_campaigns
 set title=trim(p_title),
     enabled=p_enabled,
     ends_at=p_ends,
     prize_caption=trim(p_caption),
     prize_path=p_prize,
     updated_at=clock_timestamp()
 returning * into result;
 return result;
end $$;

-- Disable legacy email/Supabase-Auth activity endpoints.
revoke all on function public.activity_save_profile(text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.activity_submit(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.activity_review(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.activity_settings(text,boolean,timestamptz,text,text) from public,anon,authenticated,service_role;
revoke all on function public.activity_is_admin() from public,anon,authenticated,service_role;
revoke all on function public.activity_notifications() from public,anon,authenticated,service_role;

create or replace function public.activity_register(p_student_id text,p_password text)
returns table(session_token text,user_id uuid,student_id text,is_admin boolean)
language sql security definer set search_path='' as $$
 select * from activity_private.register(p_student_id,p_password);
$$;

create or replace function public.activity_login(p_student_id text,p_password text)
returns table(session_token text,user_id uuid,student_id text,is_admin boolean)
language sql security definer set search_path='' as $$
 select * from activity_private.login(p_student_id,p_password);
$$;

create or replace function public.activity_logout(p_session text) returns void
language sql security definer set search_path='' as $$
 select activity_private.logout(p_session);
$$;

create or replace function public.activity_me(p_session text)
returns table(user_id uuid,student_id text,is_admin boolean)
language sql stable security definer set search_path='' as $$
 select * from activity_private.me(p_session);
$$;

create or replace function public.activity_own_profile(p_session text) returns setof public.activity_profiles
language sql stable security definer set search_path='' as $$
 select * from activity_private.own_profile(p_session);
$$;

create or replace function public.activity_own_history(p_session text)
returns table(id uuid,status text,submitted_at timestamptz,rejection_note text,photo_path text)
language sql stable security definer set search_path='' as $$
 select * from activity_private.own_history(p_session);
$$;

create or replace function public.activity_save_profile(p_session text,p_name text,p_faculty text,p_major text)
returns public.activity_profiles
language sql security definer set search_path='' as $$
 select activity_private.save_profile(p_session,p_name,p_faculty,p_major);
$$;

create or replace function public.activity_submit(p_session text,p_id uuid,p_campaign uuid,p_photo text) returns uuid
language sql security definer set search_path='' as $$
 select activity_private.submit(p_session,p_id,p_campaign,p_photo);
$$;

create or replace function public.activity_admin_queue(p_session text)
returns table(
 id uuid,status text,photo_path text,submitted_at timestamptz,reviewed_at timestamptz,
 rejection_note text,display_name text,faculty text,major text
)
language sql stable security definer set search_path='' as $$
 select * from activity_private.admin_queue(p_session);
$$;

create or replace function public.activity_review(p_session text,p_id uuid,p_decision text,p_note text default '') returns text
language sql security definer set search_path='' as $$
 select activity_private.review(p_session,p_id,p_decision,p_note);
$$;

create or replace function public.activity_settings(
 p_session text,p_title text,p_enabled boolean,p_ends timestamptz,p_caption text,p_prize text
) returns public.activity_campaigns
language sql security definer set search_path='' as $$
 select activity_private.settings(p_session,p_title,p_enabled,p_ends,p_caption,p_prize);
$$;

revoke all on function activity_private.student_id_ok(text) from public,anon,authenticated;
revoke all on function activity_private.password_ok(text) from public,anon,authenticated;
revoke all on function activity_private.account_from_session(text) from public,anon,authenticated;
revoke all on function activity_private.is_admin_account(uuid) from public,anon,authenticated;
revoke all on function activity_private.issue_session(uuid) from public,anon,authenticated;
revoke all on function activity_private.register(text,text) from public,anon,authenticated;
revoke all on function activity_private.login(text,text) from public,anon,authenticated;
revoke all on function activity_private.logout(text) from public,anon,authenticated;
revoke all on function activity_private.me(text) from public,anon,authenticated;
revoke all on function activity_private.own_profile(text) from public,anon,authenticated;
revoke all on function activity_private.own_history(text) from public,anon,authenticated;
revoke all on function activity_private.save_profile(text,text,text,text) from public,anon,authenticated;
revoke all on function activity_private.submit(text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function activity_private.admin_queue(text) from public,anon,authenticated;
revoke all on function activity_private.review(text,uuid,text,text) from public,anon,authenticated;
revoke all on function activity_private.settings(text,text,boolean,timestamptz,text,text) from public,anon,authenticated;

revoke all on function public.activity_register(text,text) from public,anon,authenticated;
revoke all on function public.activity_login(text,text) from public,anon,authenticated;
revoke all on function public.activity_logout(text) from public,anon,authenticated;
revoke all on function public.activity_me(text) from public,anon,authenticated;
revoke all on function public.activity_own_profile(text) from public,anon,authenticated;
revoke all on function public.activity_own_history(text) from public,anon,authenticated;
revoke all on function public.activity_save_profile(text,text,text,text) from public,anon,authenticated;
revoke all on function public.activity_submit(text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.activity_admin_queue(text) from public,anon,authenticated;
revoke all on function public.activity_review(text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.activity_settings(text,text,boolean,timestamptz,text,text) from public,anon,authenticated;

grant execute on function public.activity_register(text,text) to anon,authenticated,service_role;
grant execute on function public.activity_login(text,text) to anon,authenticated,service_role;
grant execute on function public.activity_logout(text) to anon,authenticated,service_role;
grant execute on function public.activity_me(text) to anon,authenticated,service_role;
grant execute on function public.activity_own_profile(text) to anon,authenticated,service_role;
grant execute on function public.activity_own_history(text) to anon,authenticated,service_role;
grant execute on function public.activity_save_profile(text,text,text,text) to anon,authenticated,service_role;
grant execute on function public.activity_submit(text,uuid,uuid,text) to anon,authenticated,service_role;
grant execute on function public.activity_admin_queue(text) to anon,authenticated,service_role;
grant execute on function public.activity_review(text,uuid,text,text) to anon,authenticated,service_role;
grant execute on function public.activity_settings(text,text,boolean,timestamptz,text,text) to anon,authenticated,service_role;

commit;
