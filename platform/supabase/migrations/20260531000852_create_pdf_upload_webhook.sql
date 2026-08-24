
-- Enable pg_net for async HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Webhook function: fires edge function on pdf_uploads INSERT
CREATE OR REPLACE FUNCTION trigger_correction_check()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/process-correction',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'pdf_uploads',
      'schema', 'public',
      'record', row_to_json(NEW)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_pdf_upload_inserted
  AFTER INSERT ON pdf_uploads
  FOR EACH ROW EXECUTE FUNCTION trigger_correction_check();
;
