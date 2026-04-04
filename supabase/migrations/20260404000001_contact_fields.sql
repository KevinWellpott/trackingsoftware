-- Migration: neue Kontaktfelder + profiles-Tabelle + username-Login + RLS-Fix

-- ---------------------------------------------------------------------------
-- RLS Fix: workspace_members self-reference vermeiden
-- ---------------------------------------------------------------------------

drop policy if exists "wm_select_member" on public.workspace_members;

create policy "wm_select_member" on public.workspace_members
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Pitch-Text auf Listen
-- ---------------------------------------------------------------------------

alter table public.lists
  add column if not exists pitch_text text;

-- ---------------------------------------------------------------------------
-- Neue Spalten auf contacts
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists pitched_at date,
  add column if not exists follow_up_number int check (
    follow_up_number is null or follow_up_number in (1, 2, 3)
  ),
  add column if not exists answered boolean,
  add column if not exists appointment_set boolean,
  add column if not exists answer_text text;

-- ---------------------------------------------------------------------------
-- Profiles-Tabelle (Username → auth.users)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_workspace_member" on public.profiles
  for select using (
    user_id = auth.uid ()
    or exists (
      select 1
      from public.workspace_members wm1
      join public.workspace_members wm2 on wm1.workspace_id = wm2.workspace_id
      where wm1.user_id = auth.uid ()
        and wm2.user_id = profiles.user_id
    )
  );

create policy "profiles_insert_own" on public.profiles
  for insert with check (user_id = auth.uid ());

create policy "profiles_update_own" on public.profiles
  for update using (user_id = auth.uid ());

-- ---------------------------------------------------------------------------
-- RPC: E-Mail via Benutzername ermitteln (für Username-Login)
-- ---------------------------------------------------------------------------

create or replace function public.get_email_by_username (p_username text)
returns text
language sql
security definer
set search_path = auth, public
as $$
  select u.email
  from auth.users u
  join public.profiles p on p.user_id = u.id
  where lower(p.username) = lower(trim(p_username))
  limit 1;
$$;

grant execute on function public.get_email_by_username (text) to anon;
grant execute on function public.get_email_by_username (text) to authenticated;
