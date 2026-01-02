-- Create pg_cron job to publish quizzes at 11:30 UTC daily
-- Note: This requires pg_cron extension to be enabled

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule job to run publish-quiz Edge Function at 11:30 UTC daily
-- The job calls the Edge Function via HTTP
SELECT cron.schedule(
  'publish-quiz-daily',
  '30 11 * * *', -- 11:30 UTC daily
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/publish-quiz',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Note: You'll need to set these settings:
-- ALTER DATABASE postgres SET app.settings.supabase_url = 'https://your-project.supabase.co';
-- ALTER DATABASE postgres SET app.settings.supabase_service_role_key = 'your-service-role-key';

