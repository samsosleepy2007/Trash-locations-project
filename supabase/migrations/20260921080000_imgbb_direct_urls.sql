-- Use ImgBB direct URLs for activity images and make campaign start resilient.
begin;

create table if not exists activity_private.integration_secrets (
  name text primary key,
  secret_value text not null,
  updated_at timestamptz not null default now()
);
alter table activity_private.integration_secrets enable row level security;
revoke all on activity_private.integration_secrets from public,anon,authenticated;

create or replace function public.activity_imgbb_key() returns text
language sql
security definer
set search_path=''
as $$
  select s.secret_value
  from activity_private.integration_secrets s
  where s.name='imgbb_api_key'
  limit 1;
$$;
revoke all on function public.activity_imgbb_key() from public,anon,authenticated;
grant execute on function public.activity_imgbb_key() to service_role;

alter table public.activity_submissions
  alter column proof_object_id drop not null;

create or replace function activity_private.is_imgbb_direct_url(p_url text) returns boolean
language sql
immutable
set search_path=''
as $$
  select coalesce(p_url,'') ~ '^https://i\.ibb\.co/[^[:space:]]+$';
$$;
revoke all on function activity_private.is_imgbb_direct_url(text) from public,anon,authenticated;

create or replace function activity_private.submit(
  p_session text,p_id uuid,p_campaign uuid,p_photo text
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  account_id uuid:=activity_private.account_from_session(p_session);
  campaign public.activity_campaigns;
  existing public.activity_submissions;
begin
  if account_id is null then raise exception 'SESSION_REQUIRED'; end if;
  if not exists(select 1 from public.activity_profiles where user_id=account_id) then
    raise exception 'PROFILE_REQUIRED';
  end if;

  select * into existing from public.activity_submissions where id=p_id;
  if found then
    if existing.user_id=account_id
       and existing.photo_path=p_photo
       and existing.campaign_id=p_campaign then
      return p_id;
    end if;
    raise exception 'SUBMISSION_CONFLICT';
  end if;

  select * into campaign
  from public.activity_campaigns
  where id=p_campaign
  for share;

  if not found or not campaign.enabled or campaign.ends_at is null
     or clock_timestamp()>=campaign.ends_at then
    raise exception 'CAMPAIGN_CLOSED';
  end if;

  if not activity_private.is_imgbb_direct_url(p_photo) then
    raise exception 'INVALID_PHOTO_URL';
  end if;

  insert into public.activity_submissions(
    id,campaign_id,user_id,photo_path,proof_object_id
  ) values(
    p_id,p_campaign,account_id,p_photo,null
  );

  return p_id;
end $$;

create or replace function activity_private.settings(
  p_session text,p_title text,p_enabled boolean,p_ends timestamptz,p_caption text,p_prize text
) returns public.activity_campaigns
language plpgsql
security definer
set search_path=''
as $$
declare
  account_id uuid:=activity_private.account_from_session(p_session);
  result public.activity_campaigns;
  effective_ends timestamptz:=p_ends;
begin
  if not activity_private.is_admin_account(account_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_enabled and effective_ends is null then
    effective_ends:=clock_timestamp()+interval '7 days';
  end if;

  if p_enabled and effective_ends<=clock_timestamp() then
    raise exception 'END_TIME_MUST_BE_FUTURE';
  end if;

  if p_prize is not null and trim(p_prize)<>'' and not activity_private.is_imgbb_direct_url(p_prize) then
    raise exception 'INVALID_PRIZE_URL';
  end if;

  update public.activity_campaigns
  set title=trim(p_title),
      enabled=p_enabled,
      ends_at=effective_ends,
      prize_caption=trim(p_caption),
      prize_path=nullif(trim(p_prize),''),
      updated_at=clock_timestamp()
  returning * into result;

  return result;
end $$;

commit;
