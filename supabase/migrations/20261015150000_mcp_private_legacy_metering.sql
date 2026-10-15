BEGIN;
-- The original function predates explicit PUBLIC revocation. Only the trusted
-- API service may invoke either metering implementation, including its internal
-- legacy path. Paid/public callers must go through authenticated HTTP access.
REVOKE ALL ON FUNCTION public.consume_mcp_api_request(text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_mcp_api_request(text,timestamptz) TO service_role;
COMMIT;
