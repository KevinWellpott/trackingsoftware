-- Account-level data visibility for scoped workspace members.

alter table public.workspace_members
  add column if not exists data_scope text not null default 'workspace'
  check (data_scope in ('workspace', 'own'));

alter table public.lists
  add column if not exists created_by_user_id uuid references auth.users (id) on delete set null;

alter table public.organic_lists
  add column if not exists created_by_user_id uuid references auth.users (id) on delete set null;

update public.lists l
set created_by_user_id = p.user_id
from public.profiles p
where l.created_by_user_id is null
  and l.owner_name is not null
  and lower(l.owner_name) = lower(p.username);

update public.organic_lists l
set created_by_user_id = p.user_id
from public.profiles p
where l.created_by_user_id is null
  and l.owner_name is not null
  and lower(l.owner_name) = lower(p.username);

create index if not exists idx_workspace_members_scope
  on public.workspace_members (workspace_id, user_id, data_scope);

create index if not exists idx_lists_workspace_created_by
  on public.lists (workspace_id, created_by_user_id);

create index if not exists idx_organic_lists_workspace_created_by
  on public.organic_lists (workspace_id, created_by_user_id);

create or replace function public.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = 'owner'
  );
$$;

create or replace function public.set_created_by_user_id()
returns trigger
language plpgsql
as $$
begin
  if new.created_by_user_id is null then
    new.created_by_user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists lists_created_by_bi on public.lists;
create trigger lists_created_by_bi
before insert on public.lists
for each row
execute function public.set_created_by_user_id();

drop trigger if exists organic_lists_created_by_bi on public.organic_lists;
create trigger organic_lists_created_by_bi
before insert on public.organic_lists
for each row
execute function public.set_created_by_user_id();

create or replace function public.can_access_owned_workspace_row(
  p_workspace_id uuid,
  p_created_by_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and (
        wm.data_scope = 'workspace'
        or (
          wm.data_scope = 'own'
          and p_created_by_user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_access_pitch_list(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lists l
    join public.workspace_members wm on wm.workspace_id = l.workspace_id
    where l.id = p_list_id
      and wm.user_id = auth.uid()
      and (
        wm.data_scope = 'workspace'
        or (
          wm.data_scope = 'own'
          and l.created_by_user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_access_organic_list(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organic_lists l
    join public.workspace_members wm on wm.workspace_id = l.workspace_id
    where l.id = p_list_id
      and wm.user_id = auth.uid()
      and (
        wm.data_scope = 'workspace'
        or (
          wm.data_scope = 'own'
          and l.created_by_user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.is_workspace_owner(uuid) to authenticated;

drop policy if exists "wm_select_owner_same_workspace" on public.workspace_members;
create policy "wm_select_owner_same_workspace" on public.workspace_members
  for select using (
    public.is_workspace_owner(workspace_members.workspace_id)
  );

grant execute on function public.can_access_owned_workspace_row(uuid, uuid) to authenticated;
grant execute on function public.can_access_pitch_list(uuid) to authenticated;
grant execute on function public.can_access_organic_list(uuid) to authenticated;

drop policy if exists "lists_all_member" on public.lists;
drop policy if exists "contacts_all_member" on public.contacts;
drop policy if exists "stages_all_member" on public.pipeline_stages;
drop policy if exists "organic_lists_all_member" on public.organic_lists;
drop policy if exists "organic_posts_all_member" on public.organic_posts;

create policy "lists_scoped_member" on public.lists
  for all using (
    public.can_access_owned_workspace_row(lists.workspace_id, lists.created_by_user_id)
  )
  with check (
    public.can_access_owned_workspace_row(lists.workspace_id, lists.created_by_user_id)
  );

create policy "stages_scoped_member" on public.pipeline_stages
  for all using (
    public.can_access_pitch_list(pipeline_stages.list_id)
  )
  with check (
    public.can_access_pitch_list(pipeline_stages.list_id)
  );

create policy "contacts_scoped_member" on public.contacts
  for all using (
    public.can_access_pitch_list(contacts.list_id)
  )
  with check (
    public.can_access_pitch_list(contacts.list_id)
  );

create policy "organic_lists_scoped_member" on public.organic_lists
  for all using (
    public.can_access_owned_workspace_row(organic_lists.workspace_id, organic_lists.created_by_user_id)
  )
  with check (
    public.can_access_owned_workspace_row(organic_lists.workspace_id, organic_lists.created_by_user_id)
  );

create policy "organic_posts_scoped_member" on public.organic_posts
  for all using (
    public.can_access_organic_list(organic_posts.list_id)
  )
  with check (
    public.can_access_organic_list(organic_posts.list_id)
  );
