-- Require a clear reason whenever an activity submission is rejected.
begin;

alter table public.activity_submissions
  add constraint activity_rejection_reason_required
  check (status <> 'rejected' or nullif(trim(rejection_note),'') is not null);

alter table activity_private.mail_outbox
  add constraint activity_mail_reason_required
  check (char_length(trim(note)) between 1 and 500);

create or replace function activity_private.review(p_id uuid,p_decision text,p_note text default '') returns text
language plpgsql security definer set search_path='' as $$
declare item public.activity_submissions; email_address text; normalized_note text;
begin
 if not activity_private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if p_decision not in ('approved','rejected') or p_decision is null then raise exception 'INVALID_DECISION'; end if;
 normalized_note:=trim(coalesce(p_note,''));
 if p_decision='rejected' and normalized_note='' then raise exception 'REJECTION_REASON_REQUIRED'; end if;
 select * into item from public.activity_submissions where id=p_id for update;
 if not found then raise exception 'SUBMISSION_NOT_FOUND'; end if;
 if item.status=p_decision then return item.status; end if;
 if item.status<>'pending' then raise exception 'ALREADY_REVIEWED'; end if;
 update public.activity_submissions
 set status=p_decision,
     reviewed_at=clock_timestamp(),
     reviewed_by=auth.uid(),
     rejection_note=case when p_decision='rejected' then normalized_note else null end
 where id=p_id;
 if p_decision='rejected' then
  select email into email_address from auth.users where id=item.user_id;
  insert into activity_private.mail_outbox(submission_id,recipient,note)
  values(p_id,email_address,normalized_note);
 end if;
 return p_decision;
end $$;

revoke all on function activity_private.review(uuid,text,text) from public,anon,authenticated;
grant execute on function activity_private.review(uuid,text,text) to authenticated;
commit;
