begin;

create or replace function activity_private.clear_debug_logs(p_session text) returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  account_id uuid:=activity_private.account_from_session(p_session);
  n integer;
begin
  if not activity_private.is_admin_account(account_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  delete from activity_private.debug_logs
  where id is not null;

  get diagnostics n = row_count;
  return n;
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
    if activity_private.is_imgbb_direct_url(p_prize)
       or activity_private.is_github_prize_url(p_prize) then
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
    elsif activity_private.is_direct_prize_url(p_prize) then
      null;
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
  where singleton = true
  returning * into result;

  if result.id is null then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;

  return result;
end $$;

commit;
