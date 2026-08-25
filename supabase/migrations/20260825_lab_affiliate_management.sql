create table if not exists public.committee_admins (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.committee_admins enable row level security;

revoke all on table public.committee_admins from public, anon, authenticated;
grant select on table public.committee_admins to service_role;

-- Administrator assignments are provisioned directly in Supabase and are
-- intentionally excluded from source control.

comment on table public.committee_admins is
  'Authoritative server-side allowlist for Seccion Sindical administrators.';
