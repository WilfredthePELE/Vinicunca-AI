-- Vinicunca attendee and attendance tables.
-- Run once in Supabase Dashboard → SQL Editor → New query.

create table if not exists public.event_attendees (
  id text primary key,
  name text not null,
  tier text not null default 'Invited Guest',
  table_name text not null default 'Main Pavilion'
);

create table if not exists public.event_checkins (
  attendee_id text primary key references public.event_attendees(id) on delete cascade,
  name text not null,
  checked_in_at timestamptz not null default now()
);

alter table public.event_attendees enable row level security;
alter table public.event_checkins enable row level security;

revoke all on public.event_attendees from anon, authenticated;
revoke all on public.event_checkins from anon, authenticated;
grant all on public.event_attendees to service_role;
grant all on public.event_checkins to service_role;
