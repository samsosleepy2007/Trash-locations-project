begin;

create or replace function activity_private.is_storage_proof_ref(p_value text) returns boolean
language sql
immutable
set search_path=''
as $$
  select coalesce(p_value,'') ~ '^storage://activity-proofs/[0-9a-f-]{36}/[^[:space:]]+$';
$$;

create or replace function activity_private.is_public_prize_url(p_value text) returns boolean
language sql
immutable
set search_path=''
as $$
  select coalesce(p_value,'') ~ '^https://ejhlgroeoyvsyhntagvs\.supabase\.co/storage/v1/object/public/activity-prizes/[^[:space:]]+$';
$$;

revoke all on function activity_private.is_storage_proof_ref(text) from public,anon,authenticated;
revoke all on function activity_private.is_public_prize_url(text) from public,anon,authenticated;

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
  object_id uuid;
  object_name text;
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

  if activity_private.is_imgbb_direct_url(p_photo) then
    object_id:=null;
  elsif activity_private.is_storage_proof_ref(p_photo) then
    object_name:=substring(p_photo from char_length('storage://activity-proofs/')+1);
    if object_name not like account_id::text || '/%' then
      raise exception 'INVALID_PHOTO_URL';
    end if;
    select o.id into object_id
    from storage.objects o
    where o.bucket_id='activity-proofs' and o.name=object_name
    limit 1;
    if object_id is null then raise exception 'PHOTO_REQUIRED'; end if;
  else
    raise exception 'INVALID_PHOTO_URL';
  end if;

  insert into public.activity_submissions(
    id,campaign_id,user_id,photo_path,proof_object_id
  ) values(
    p_id,p_campaign,account_id,p_photo,object_id
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
  prize_object text;
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

  if p_prize is not null and trim(p_prize)<>'' then
    if activity_private.is_imgbb_direct_url(p_prize) then
      null;
    elsif activity_private.is_public_prize_url(p_prize) then
      prize_object:=substring(
        p_prize from char_length('https://ejhlgroeoyvsyhntagvs.supabase.co/storage/v1/object/public/activity-prizes/')+1
      );
      if not exists(
        select 1 from storage.objects
        where bucket_id='activity-prizes' and name=prize_object
      ) then
        raise exception 'PRIZE_IMAGE_NOT_FOUND';
      end if;
    else
      raise exception 'INVALID_PRIZE_URL';
    end if;
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
