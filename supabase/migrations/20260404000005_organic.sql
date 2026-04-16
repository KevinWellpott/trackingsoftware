-- Organic Social Media Tracker: organic_lists + organic_posts

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.organic_lists (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  description  text,
  owner_name   text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table public.organic_posts (
  id                   uuid primary key default gen_random_uuid(),
  list_id              uuid not null references public.organic_lists (id) on delete cascade,
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  owner_name           text,
  posted_at            date not null default current_date,
  hook_text            text,
  topic                text,
  content_type         text check (content_type in ('educational','motivational','entertaining','bts','other') or content_type is null),
  insta_impressions    int,
  tiktok_impressions   int,
  generated_cta        boolean,
  cta_notes            text,
  stories_done         boolean,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Auto-set workspace_id from organic_list
create or replace function public.organic_posts_set_workspace()
returns trigger
language plpgsql
as $$
begin
  select l.workspace_id into strict new.workspace_id
  from public.organic_lists l
  where l.id = new.list_id;
  return new;
end;
$$;

create trigger organic_posts_workspace_bi
before insert or update of list_id on public.organic_posts
for each row
execute function public.organic_posts_set_workspace();

-- Auto-update updated_at
create or replace function public.organic_posts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organic_posts_updated_at
before update on public.organic_posts
for each row
execute function public.organic_posts_set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index idx_organic_lists_workspace on public.organic_lists (workspace_id);
create index idx_organic_posts_list on public.organic_posts (list_id);
create index idx_organic_posts_workspace_date on public.organic_posts (workspace_id, posted_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.organic_lists enable row level security;
alter table public.organic_posts enable row level security;

create policy "organic_lists_all_member" on public.organic_lists
  for all using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = organic_lists.workspace_id
        and wm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = organic_lists.workspace_id
        and wm.user_id = auth.uid()
    )
  );

create policy "organic_posts_all_member" on public.organic_posts
  for all using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = organic_posts.workspace_id
        and wm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = organic_posts.workspace_id
        and wm.user_id = auth.uid()
    )
  );
