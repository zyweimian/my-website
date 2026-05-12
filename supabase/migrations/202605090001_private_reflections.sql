create extension if not exists pgcrypto;

create table if not exists public.reflection_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input_text text not null,
  state text not null,
  action text not null,
  quote text not null,
  followup text,
  safety text not null default 'normal',
  art jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.reflection_entries enable row level security;
alter table public.analytics_events enable row level security;

create policy "Users can read their own reflection entries"
  on public.reflection_entries
  for select
  using (auth.uid() = user_id);

create policy "Users can delete their own reflection entries"
  on public.reflection_entries
  for delete
  using (auth.uid() = user_id);

create policy "Users can insert their own reflection entries"
  on public.reflection_entries
  for insert
  with check (auth.uid() = user_id);

create index if not exists reflection_entries_user_created_idx
  on public.reflection_entries (user_id, created_at desc);

create index if not exists analytics_events_name_created_idx
  on public.analytics_events (event_name, created_at desc);

create or replace view public.daily_anonymous_metrics as
select
  date_trunc('day', created_at)::date as day,
  count(*) filter (where event_name = 'page_view') as page_views,
  count(*) filter (where event_name = 'login_completed') as login_completed,
  count(*) filter (where event_name = 'reflect_created') as reflections,
  count(*) filter (where event_name = 'chat_replied') as chat_replies,
  count(*) filter (where event_name = 'entry_deleted') as entries_deleted,
  count(*) filter (where event_name = 'account_data_cleared') as account_data_cleared
from public.analytics_events
group by 1
order by 1 desc;
