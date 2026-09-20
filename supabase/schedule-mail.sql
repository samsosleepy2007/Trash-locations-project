-- Run only after pg_cron, pg_net and Vault are enabled and both Vault secrets exist.
-- Secrets must be inserted through the dashboard, never committed here.
-- Run once; for a replacement first unschedule the existing job by its job ID.
select cron.schedule(
 'nrru-activity-rejection-mail',
 '* * * * *',
 $job$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='activity_project_url') || '/functions/v1/activity-mailer',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='activity_scheduler_secret')),
   body := '{}'::jsonb,
   timeout_milliseconds := 120000
 );
 $job$
);
