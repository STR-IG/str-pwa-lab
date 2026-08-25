-- The laboratory Edge Function lists affiliates with service_role and must
-- also be able to delete the one record explicitly confirmed by an admin.
grant delete on table public.private_access_allowlist to service_role;
