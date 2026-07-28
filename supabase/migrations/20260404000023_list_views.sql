-- Smart Views: verschachtelbare, filter-definierte Ansichten auf LinkedIn-Kontakte
--
-- Bisher gab es genau eine Gliederung: die flache Liste der `lists` in der
-- Sidebar. Wer mehrere Offer, Kampagnen oder Zeitraeume parallel faehrt, kann
-- die nicht gruppieren.
--
-- Ein Knoten ist entweder
--   * ein reiner ORDNER   → `filters is null`, gruppiert nur seine Kinder
--   * eine SMART VIEW     → `filters` gesetzt, loest zu einer Kontaktmenge auf
--
-- Beides in einer Tabelle mit Selbstreferenz `parent_id`: damit ist die
-- Verschachtelung beliebig tief, ohne zwei Tabellen und ohne feste Ebenen.
--
-- Bewusst NICHT gemacht: `lists` oder `contacts` anfassen. Ansichten sind eine
-- zusaetzliche Sicht auf denselben Bestand, keine neue Ablage. Eine Liste
-- bleibt die Heimat ihrer Kontakte.

create table if not exists public.list_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Selbstreferenz: NULL = Wurzelknoten. Cascade, damit das Loeschen eines
  -- Ordners seinen Teilbaum mitnimmt statt Waisen zu hinterlassen.
  parent_id uuid references public.list_views (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  -- NULL = reiner Ordner. Gesetzt = Smart View (Struktur siehe src/lib/listViews.ts).
  filters jsonb,
  created_by_user_id uuid references auth.users (id) on delete set null,
  -- Wie bei `lists`: owner_name hat Vorrang vor created_by_user_id, damit ein
  -- Admin eine Ansicht FUER ein Mitglied anlegen kann (docs/data-model.md §2).
  owner_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_list_views_ws_parent
  on public.list_views (workspace_id, parent_id, sort_order);

-- Ein Knoten darf nicht sein eigener Elternteil sein. Tiefere Zyklen kann ein
-- CHECK nicht sehen — die prueft die Server-Action beim Verschieben.
alter table public.list_views
  drop constraint if exists list_views_no_self_parent;
alter table public.list_views
  add constraint list_views_no_self_parent check (parent_id is null or parent_id <> id);

-- updated_at pflegen (gleiches Muster wie die uebrigen Tabellen)
create or replace function public.touch_list_views_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_list_views_updated_at on public.list_views;
create trigger trg_list_views_updated_at
  before update on public.list_views
  for each row execute function public.touch_list_views_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — identisches Muster wie lists/phone_lists (Migration 000006/000008)
-- ---------------------------------------------------------------------------

alter table public.list_views enable row level security;

drop policy if exists "list_views_scoped_member" on public.list_views;
create policy "list_views_scoped_member" on public.list_views
  for all using (public.can_access_owned_workspace_row(list_views.workspace_id, list_views.created_by_user_id))
  with check (public.can_access_owned_workspace_row(list_views.workspace_id, list_views.created_by_user_id));
