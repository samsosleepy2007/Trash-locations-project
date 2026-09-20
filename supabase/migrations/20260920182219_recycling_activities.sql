-- Dedicated NRRU activities backend. Apply to a separate Supabase project.
begin;
create schema if not exists activity_private;
revoke all on schema activity_private from public;
grant usage on schema activity_private to anon, authenticated, service_role;

create table public.activity_campaigns (
 id uuid primary key default gen_random_uuid(), singleton boolean not null default true unique check(singleton),
 title text not null default 'แยกให้ถูก ทิ้งให้เป็น' check(char_length(title) between 1 and 120),
 enabled boolean not null default false, ends_at timestamptz,
 prize_caption text not null default 'รอประกาศของรางวัล' check(char_length(prize_caption)<=500),
 prize_path text, updated_at timestamptz not null default now(),
 check(not enabled or ends_at is not null)
);
insert into public.activity_campaigns default values;
create table public.activity_profiles (
 user_id uuid primary key references auth.users(id),
 display_name text not null check(char_length(trim(display_name)) between 1 and 80),
 faculty text not null check(char_length(trim(faculty)) between 1 and 120),
 major text not null check(char_length(trim(major)) between 1 and 120),
 created_at timestamptz not null default now()
);
create table activity_private.admins (user_id uuid primary key references auth.users(id));
create table public.activity_submissions (
 id uuid primary key, campaign_id uuid not null references public.activity_campaigns(id),
 user_id uuid not null references public.activity_profiles(user_id), photo_path text not null unique, proof_object_id uuid not null references storage.objects(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 submitted_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references auth.users(id),
 rejection_note text check(char_length(rejection_note)<=500),
 check((status='pending' and reviewed_at is null and reviewed_by is null) or (status<>'pending' and reviewed_at is not null and reviewed_by is not null))
);
create index activity_submissions_owner on public.activity_submissions(user_id,submitted_at desc);
create index activity_submissions_queue on public.activity_submissions(campaign_id,status,submitted_at);
create index activity_submissions_proof on public.activity_submissions(proof_object_id);
create index activity_submissions_reviewer on public.activity_submissions(reviewed_by);
create table activity_private.mail_outbox (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null unique references public.activity_submissions(id),
 recipient text not null, note text not null, state text not null default 'pending' check(state in ('pending','sending','sent','failed')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now(), first_attempt_at timestamptz, sent_at timestamptz, provider_id text,
 lease_id uuid, last_error text
);
create index activity_outbox_due on activity_private.mail_outbox(state,next_attempt_at);
alter table public.activity_campaigns enable row level security;
alter table public.activity_profiles enable row level security;
alter table public.activity_submissions enable row level security;
alter table activity_private.admins enable row level security;
alter table activity_private.mail_outbox enable row level security;
revoke all on public.activity_campaigns,public.activity_profiles,public.activity_submissions from anon,authenticated;
revoke all on activity_private.admins,activity_private.mail_outbox from public,anon,authenticated;
grant select on public.activity_campaigns to anon,authenticated;
grant select on public.activity_profiles,public.activity_submissions to authenticated;

-- Checks the persisted, confirmed email, not editable metadata or a stale JWT email.
create function activity_private.university_user() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email) ~ '^[^@[:space:]]+@nrru\.ac\.th$');
$$;
create function activity_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select activity_private.university_user() and exists(select 1 from activity_private.admins where user_id=auth.uid());
$$;
create function activity_private.is_open() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.activity_campaigns where enabled and now()<ends_at);
$$;
create policy campaign_public on public.activity_campaigns for select to anon,authenticated using(true);
create policy profile_self_or_admin on public.activity_profiles for select to authenticated using((select activity_private.university_user()) and (user_id=(select auth.uid()) or (select activity_private.is_admin())));
create policy submissions_self_or_admin on public.activity_submissions for select to authenticated using((select activity_private.university_user()) and (user_id=(select auth.uid()) or (select activity_private.is_admin())));

create function activity_private.lock_profile() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'PROFILE_LOCKED'; end $$;
create trigger activity_profile_immutable before update or delete on public.activity_profiles for each row execute function activity_private.lock_profile();

create function activity_private.save_profile(p_name text,p_faculty text,p_major text) returns public.activity_profiles language plpgsql security definer set search_path='' as $$
declare result public.activity_profiles;
begin
 if not activity_private.university_user() then raise exception 'UNIVERSITY_EMAIL_REQUIRED'; end if;
 insert into public.activity_profiles(user_id,display_name,faculty,major) values(auth.uid(),trim(p_name),trim(p_faculty),trim(p_major)) on conflict(user_id) do nothing;
 select * into result from public.activity_profiles where user_id=auth.uid();
 if result.display_name<>trim(p_name) or result.faculty<>trim(p_faculty) or result.major<>trim(p_major) then raise exception 'PROFILE_LOCKED'; end if;
 return result;
end $$;

create function activity_private.submit(p_id uuid,p_campaign uuid,p_photo text) returns uuid language plpgsql security definer set search_path='' as $$
declare campaign public.activity_campaigns; existing public.activity_submissions; object_id uuid;
begin
 if not activity_private.university_user() then raise exception 'UNIVERSITY_EMAIL_REQUIRED'; end if;
 if not exists(select 1 from public.activity_profiles where user_id=auth.uid()) then raise exception 'PROFILE_REQUIRED'; end if;
 select * into existing from public.activity_submissions where id=p_id;
 if found then
  if existing.user_id=auth.uid() and existing.photo_path=p_photo and existing.campaign_id=p_campaign then return p_id; end if;
  raise exception 'SUBMISSION_CONFLICT';
 end if;
 select * into campaign from public.activity_campaigns where id=p_campaign for share;
 if not found or not campaign.enabled or campaign.ends_at is null or clock_timestamp()>=campaign.ends_at then raise exception 'CAMPAIGN_CLOSED'; end if;
 if p_photo !~ ('^'||auth.uid()::text||'/'||p_id::text||'\.(jpg|jpeg|png|webp)$') then raise exception 'INVALID_PHOTO_PATH'; end if;
 select id into object_id from storage.objects where bucket_id='activity-proofs' and name=p_photo for share;
 if not found then raise exception 'PHOTO_REQUIRED'; end if;
 insert into public.activity_submissions(id,campaign_id,user_id,photo_path,proof_object_id) values(p_id,p_campaign,auth.uid(),p_photo,object_id);
 return p_id;
end $$;

create function activity_private.review(p_id uuid,p_decision text,p_note text default '') returns text language plpgsql security definer set search_path='' as $$
declare item public.activity_submissions; email_address text;
begin
 if not activity_private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if p_decision not in ('approved','rejected') or p_decision is null then raise exception 'INVALID_DECISION'; end if;
 select * into item from public.activity_submissions where id=p_id for update;
 if not found then raise exception 'SUBMISSION_NOT_FOUND'; end if;
 if item.status=p_decision then return item.status; end if;
 if item.status<>'pending' then raise exception 'ALREADY_REVIEWED'; end if;
 update public.activity_submissions set status=p_decision,reviewed_at=clock_timestamp(),reviewed_by=auth.uid(),rejection_note=case when p_decision='rejected' then trim(coalesce(p_note,'')) else null end where id=p_id;
 if p_decision='rejected' then
  select email into email_address from auth.users where id=item.user_id;
  insert into activity_private.mail_outbox(submission_id,recipient,note) values(p_id,email_address,trim(coalesce(p_note,'')));
 end if;
 return p_decision;
end $$;

create function activity_private.settings(p_title text,p_enabled boolean,p_ends timestamptz,p_caption text,p_prize text) returns public.activity_campaigns language plpgsql security definer set search_path='' as $$
declare result public.activity_campaigns;
begin
 if not activity_private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if p_enabled and (p_ends is null or p_ends<=clock_timestamp()) then raise exception 'END_TIME_MUST_BE_FUTURE'; end if;
 if p_prize is not null and not exists(select 1 from storage.objects where bucket_id='activity-prizes' and name=p_prize) then raise exception 'PRIZE_IMAGE_NOT_FOUND'; end if;
 update public.activity_campaigns set title=trim(p_title),enabled=p_enabled,ends_at=p_ends,prize_caption=trim(p_caption),prize_path=p_prize,updated_at=clock_timestamp() returning * into result;
 return result;
end $$;

-- Public aggregate deliberately returns only leaderboard fields, never emails/photos.
create function activity_private.leaderboard(p_campaign uuid) returns table(rank bigint,display_name text,faculty text,major text,points bigint) language sql stable security definer set search_path='' as $$
 select row_number() over(order by count(*) desc,min(s.reviewed_at),p.created_at,p.user_id),p.display_name,p.faculty,p.major,count(*)
 from public.activity_submissions s join public.activity_profiles p on p.user_id=s.user_id
 where s.campaign_id=p_campaign and s.status='approved'
 group by p.user_id,p.display_name,p.faculty,p.major,p.created_at
 order by count(*) desc,min(s.reviewed_at),p.created_at,p.user_id limit 100;
$$;
create function activity_private.notifications() returns table(submission_id uuid,state text,attempts integer,sent_at timestamptz) language plpgsql stable security definer set search_path='' as $$
begin
 if not activity_private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 return query select o.submission_id,o.state,o.attempts,o.sent_at from activity_private.mail_outbox o order by o.created_at desc limit 200;
end $$;

-- Invoker-only API wrappers. Privileged implementation lives in an unexposed schema.
create function public.activity_save_profile(p_name text,p_faculty text,p_major text) returns public.activity_profiles language sql security invoker set search_path='' as $$select activity_private.save_profile(p_name,p_faculty,p_major)$$;
create function public.activity_submit(p_id uuid,p_campaign uuid,p_photo text) returns uuid language sql security invoker set search_path='' as $$select activity_private.submit(p_id,p_campaign,p_photo)$$;
create function public.activity_review(p_id uuid,p_decision text,p_note text default '') returns text language sql security invoker set search_path='' as $$select activity_private.review(p_id,p_decision,p_note)$$;
create function public.activity_settings(p_title text,p_enabled boolean,p_ends timestamptz,p_caption text,p_prize text) returns public.activity_campaigns language sql security invoker set search_path='' as $$select activity_private.settings(p_title,p_enabled,p_ends,p_caption,p_prize)$$;
create function public.activity_is_admin() returns boolean language sql stable security invoker set search_path='' as $$select activity_private.is_admin()$$;
create function public.activity_leaderboard(p_campaign uuid) returns table(rank bigint,display_name text,faculty text,major text,points bigint) language sql stable security invoker set search_path='' as $$select * from activity_private.leaderboard(p_campaign)$$;
create function public.activity_notifications() returns table(submission_id uuid,state text,attempts integer,sent_at timestamptz) language sql stable security invoker set search_path='' as $$select * from activity_private.notifications()$$;

-- Mail leases prevent concurrent workers from claiming the same notification.
create function activity_private.claim_mail() returns setof activity_private.mail_outbox language plpgsql security definer set search_path='' as $$
begin
 update activity_private.mail_outbox set state='failed',last_error='RETRY_WINDOW_EXPIRED' where state in ('pending','sending') and (attempts>=6 or first_attempt_at<now()-interval '23 hours');
 return query update activity_private.mail_outbox o set state='sending',attempts=o.attempts+1,lease_id=gen_random_uuid(),first_attempt_at=coalesce(o.first_attempt_at,now()),next_attempt_at=now()+interval '5 minutes'
 where o.id in (select id from activity_private.mail_outbox where state in ('pending','sending') and next_attempt_at<=now() and attempts<6 order by created_at for update skip locked limit 5) returning o.*;
end $$;
create function activity_private.finish_mail(p_id uuid,p_lease uuid,p_provider text,p_error text) returns void language sql security definer set search_path='' as $$
 update activity_private.mail_outbox set state=case when p_provider is not null then 'sent' when attempts>=6 then 'failed' else 'pending' end,
 provider_id=p_provider,sent_at=case when p_provider is not null then now() else null end,last_error=left(p_error,200),next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,attempts)::int)),lease_id=null
 where id=p_id and lease_id=p_lease and state='sending';
$$;
create function public.activity_claim_mail() returns setof activity_private.mail_outbox language sql security invoker set search_path='' as $$select * from activity_private.claim_mail()$$;
create function public.activity_finish_mail(p_id uuid,p_lease uuid,p_provider text,p_error text) returns void language sql security invoker set search_path='' as $$select activity_private.finish_mail(p_id,p_lease,p_provider,p_error)$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('activity-proofs','activity-proofs',false,8388608,array['image/jpeg','image/png','image/webp']),
 ('activity-prizes','activity-prizes',true,8388608,array['image/jpeg','image/png','image/webp']);
create policy activity_proofs_insert on storage.objects for insert to authenticated with check(bucket_id='activity-proofs' and (select activity_private.university_user()) and (select activity_private.is_open()) and (storage.foldername(name))[1]=(select auth.uid())::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$');
create policy activity_proofs_read on storage.objects for select to authenticated using(bucket_id='activity-proofs' and (select activity_private.university_user()) and ((storage.foldername(name))[1]=(select auth.uid())::text or (select activity_private.is_admin())));
create policy activity_proofs_orphan_delete on storage.objects for delete to authenticated using(bucket_id='activity-proofs' and (select activity_private.university_user()) and (storage.foldername(name))[1]=(select auth.uid())::text and not exists(select 1 from public.activity_submissions s where s.photo_path=name));
create policy activity_prizes_insert on storage.objects for insert to authenticated with check(bucket_id='activity-prizes' and (select activity_private.is_admin()));
create policy activity_prizes_admin_read on storage.objects for select to authenticated using(bucket_id='activity-prizes' and (select activity_private.is_admin()));

-- PostgreSQL grants EXECUTE to PUBLIC by default: close every endpoint explicitly.
revoke all on all functions in schema activity_private from public,anon,authenticated;
grant execute on function activity_private.university_user(),activity_private.is_admin(),activity_private.is_open() to authenticated;
grant execute on function activity_private.save_profile(text,text,text),activity_private.submit(uuid,uuid,text),activity_private.review(uuid,text,text),activity_private.settings(text,boolean,timestamptz,text,text),activity_private.notifications() to authenticated;
grant execute on function activity_private.leaderboard(uuid) to anon,authenticated;
grant execute on function activity_private.claim_mail(),activity_private.finish_mail(uuid,uuid,text,text) to service_role;
revoke all on function public.activity_save_profile(text,text,text),public.activity_submit(uuid,uuid,text),public.activity_review(uuid,text,text),public.activity_settings(text,boolean,timestamptz,text,text),public.activity_is_admin(),public.activity_leaderboard(uuid),public.activity_notifications(),public.activity_claim_mail(),public.activity_finish_mail(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.activity_save_profile(text,text,text),public.activity_submit(uuid,uuid,text),public.activity_review(uuid,text,text),public.activity_settings(text,boolean,timestamptz,text,text),public.activity_is_admin(),public.activity_notifications() to authenticated;
grant execute on function public.activity_leaderboard(uuid) to anon,authenticated;
grant execute on function public.activity_claim_mail(),public.activity_finish_mail(uuid,uuid,text,text) to service_role;
commit;
