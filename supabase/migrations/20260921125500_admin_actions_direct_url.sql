begin;

create or replace function activity_private.is_direct_prize_url(p_value text) returns boolean
language sql
immutable
set search_path=''
as $$
  select p_value is not null
     and char_length(p_value) between 9 and 2048
     and p_value ~* '^https://[^[:space:]]+$';
$$;

revoke all on function activity_private.is_direct_prize_url(text) from public,anon,authenticated;

drop function if exists public.activity_settings(text,boolean,timestamptz,text,text);
drop function if exists activity_private.settings(text,boolean,timestamptz,text,text);

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
  returning * into result;

  return result;
end $$;

commit;
