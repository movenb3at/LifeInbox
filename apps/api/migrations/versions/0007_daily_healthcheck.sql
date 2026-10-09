CREATE FUNCTION public.lifeinbox_healthcheck()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT 'ok'::text;
$$;

REVOKE ALL ON FUNCTION public.lifeinbox_healthcheck() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lifeinbox_healthcheck() TO anon, authenticated;

COMMENT ON FUNCTION public.lifeinbox_healthcheck() IS
    'Read-only DB health check. Returns a fixed value without accessing application data.';

NOTIFY pgrst, 'reload schema';
