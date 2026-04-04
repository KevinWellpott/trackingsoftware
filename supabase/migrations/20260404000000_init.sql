-- Pitch Tracker: schema + RLS + workspace bootstrap/join

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default encode(gen_random_bytes(9), 'hex'),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  primary key (workspace_id, user_id)
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  name text not null,
  probability_pct int null check (
    probability_pct is null
    or (probability_pct >= 0 and probability_pct <= 100)
  ),
  sort_order int not null default 0,
  exclude_from_followup boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  company text,
  email text,
  phone text,
  notes text,
  stage_id uuid references public.pipeline_stages (id) on delete set null,
  last_contacted_at date,
  next_follow_up_at date,
  deal_value numeric(14, 2),
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.contacts_set_workspace ()
returns trigger
language plpgsql
as $$
begin
  select l.workspace_id into strict new.workspace_id
  from public.lists l
  where l.id = new.list_id;
  return new;
end;
$$;

create trigger contacts_workspace_bi
before insert or update of list_id on public.contacts
for each row
execute function public.contacts_set_workspace ();

create or replace function public.contacts_set_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contacts_updated_at
before update on public.contacts
for each row
execute function public.contacts_set_updated_at ();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index idx_workspace_members_user on public.workspace_members (user_id);
create index idx_lists_workspace on public.lists (workspace_id);
create index idx_pipeline_stages_list on public.pipeline_stages (list_id);
create index idx_contacts_list on public.contacts (list_id);
create index idx_contacts_workspace_followup on public.contacts (workspace_id, next_follow_up_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.lists enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.contacts enable row level security;

create policy "workspaces_select_member" on public.workspaces
  for select using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid ()
    )
  );

create policy "workspaces_update_owner" on public.workspaces
  for update using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid ()
        and wm.role = 'owner'
    )
  );

create policy "wm_select_member" on public.workspace_members
  for select using (
    exists (
      select 1
      from public.workspace_members wm2
      where wm2.workspace_id = workspace_members.workspace_id
        and wm2.user_id = auth.uid ()
    )
  );

create policy "wm_delete_owner_or_self" on public.workspace_members
  for delete using (
    user_id = auth.uid ()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid ()
        and wm.role = 'owner'
    )
  );

create policy "lists_all_member" on public.lists
  for all using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = lists.workspace_id
        and wm.user_id = auth.uid ()
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = lists.workspace_id
        and wm.user_id = auth.uid ()
    )
  );

create policy "stages_all_member" on public.pipeline_stages
  for all using (
    exists (
      select 1
      from public.lists l
      join public.workspace_members wm on wm.workspace_id = l.workspace_id
      where l.id = pipeline_stages.list_id
        and wm.user_id = auth.uid ()
    )
  )
  with check (
    exists (
      select 1
      from public.lists l
      join public.workspace_members wm on wm.workspace_id = l.workspace_id
      where l.id = pipeline_stages.list_id
        and wm.user_id = auth.uid ()
    )
  );

create policy "contacts_all_member" on public.contacts
  for all using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = contacts.workspace_id
        and wm.user_id = auth.uid ()
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = contacts.workspace_id
        and wm.user_id = auth.uid ()
    )
  );

-- ---------------------------------------------------------------------------
-- RPC: workspace anlegen / beitreten (kein direktes INSERT in workspaces)
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_workspace (p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid;
begin
  if auth.uid () is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from public.workspace_members where user_id = auth.uid ()) then
    raise exception 'Already in a workspace';
  end if;
  insert into public.workspaces (name)
  values (coalesce(nullif(trim(p_name), ''), 'Mein Workspace'))
  returning id into wid;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (wid, auth.uid (), 'owner');
  return wid;
end;
$$;

create or replace function public.join_workspace (p_invite text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid;
begin
  if auth.uid () is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from public.workspace_members where user_id = auth.uid ()) then
    raise exception 'Already in a workspace';
  end if;
  select w.id into wid
  from public.workspaces w
  where lower(w.invite_code) = lower(nullif(trim(p_invite), ''));
  if wid is null then
    raise exception 'Invalid invite code';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (wid, auth.uid (), 'member')
  on conflict do nothing;
  return wid;
end;
$$;

grant execute on function public.bootstrap_workspace (text) to authenticated;
grant execute on function public.join_workspace (text) to authenticated;
