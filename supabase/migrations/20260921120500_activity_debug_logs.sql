begin;

create table if not exists activity_private.debug_logs (
  id bigint generated always as identity primary key,
  account_id uuid references activity_private.accounts(id) on delete set null,
  student_id text,
  action text not null check (char_length(action) between 1 and 60),
  stage text not null check (char_length(stage) between 1 and 80),
  level text not null default 'info' check (level in ('info','warn','error')),
  code text,
  http_status integer,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists activity_debug_logs_created on activity_private.debug_logs(created_at desc);
alter table activity_private.debug_logs enable row level security;
revoke all on activity_private.debug_logs from public,anon,authenticated;

create or replace function public.activity_debug_write(
  p_account uuid,
  p_action text,
  p_stage text,
  p_level text default 'info',
  p_code text default null,
  p_http_status integer default null,
  p_detail text default null
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare sid text;
begin
  select student_id into sid from activity_private.accounts where id=p_account;
  insert into activity_private.debug_logs(
    account_id,student_id,action,stage,level,code,http_status,detail
  ) values(
    p_account,
    sid,
    left(coalesce(p_action,'unknown'),60),
    left(coalesce(p_stage,'unknown'),80),
    case when p_level in ('info','warn','error') then p_level else 'info' end,
    nullif(left(coalesce(p_code,''),120),''),
    p_http_status,
    nullif(left(coalesce(p_detail,''),1000),'')
  );
end $$;

revoke all on function public.activity_debug_write(uuid,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.activity_debug_write(uuid,text,text,text,text,integer,text) to service_role;

create or replace function activity_private.admin_logs(p_session text,p_limit integer default 100)
returns table(
  id bigint,
  student_id text,
  action text,
  stage text,
  level text,
  code text,
  http_status integer,
  detail text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare account_id uuid:=activity_private.account_from_session(p_session);
begin
  if not activity_private.is_admin_account(account_id) then raise exception 'ADMIN_REQUIRED'; end if;
  return query
  select l.id,l.student_id,l.action,l.stage,l.level,l.code,l.http_status,l.detail,l.created_at
  from activity_private.debug_logs l
  order by l.created_at desc
  limit greatest(1,least(coalesce(p_limit,100),300));
end $$;

create or replace function public.activity_admin_logs(p_session text,p_limit integer default 100)
returns table(
  id bigint,
  student_id text,
  action text,
  stage text,
  level text,
  code text,
  http_status integer,
  detail text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select * from activity_private.admin_logs(p_session,p_limit);
$$;

revoke all on function activity_private.admin_logs(text,integer) from public,anon,authenticated;
revoke all on function public.activity_admin_logs(text,integer) from public,anon,authenticated;
grant execute on function public.activity_admin_logs(text,integer) to anon,authenticated,service_role;

create or replace function activity_private.clear_debug_logs(p_session text) returns integer
language plpgsql
security definer
set search_path=''
as $$
declare account_id uuid:=activity_private.account_from_session(p_session); n integer;
begin
  if not activity_private.is_admin_account(account_id) then raise exception 'ADMIN_REQUIRED'; end if;
  delete from activity_private.debug_logs;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.activity_clear_debug_logs(p_session text) returns integer
language sql
security definer
set search_path=''
as $$
  select activity_private.clear_debug_logs(p_session);
$$;

revoke all on function activity_private.clear_debug_logs(text) from public,anon,authenticated;
revoke all on function public.activity_clear_debug_logs(text) from public,anon,authenticated;
grant execute on function public.activity_clear_debug_logs(text) to anon,authenticated,service_role;

commit;
