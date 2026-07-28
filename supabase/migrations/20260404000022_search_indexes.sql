-- Globale Suche: Trigram-Indizes fuer ilike '%…%'
--
-- Die Suche in src/app/actions/search.ts filtert mit `ilike '%begriff%'`.
-- Ein fuehrendes Wildcard schliesst jeden B-Tree-Index aus — ohne die
-- folgenden GIN-Indizes ist jede Suchanfrage ein Seq Scan ueber die
-- gesamte Tabelle. Bei den heutigen Datenmengen faellt das nicht auf,
-- mit wachsenden Listen sehr wohl.
--
-- pg_trgm zerlegt Strings in Dreiergruppen und macht damit auch
-- Teilstring-Suchen indizierbar.

create extension if not exists pg_trgm;

-- LinkedIn-Kontakte: der Hauptfall („in welcher Liste liegt dieser Name?")
create index if not exists idx_contacts_name_trgm
  on public.contacts using gin (name gin_trgm_ops);
create index if not exists idx_contacts_company_trgm
  on public.contacts using gin (company gin_trgm_ops);

-- Telefon-Leads
create index if not exists idx_phone_leads_company_trgm
  on public.phone_leads using gin (company gin_trgm_ops);
create index if not exists idx_phone_leads_decider_trgm
  on public.phone_leads using gin (decider_name gin_trgm_ops);
create index if not exists idx_phone_leads_phone_trgm
  on public.phone_leads using gin (phone gin_trgm_ops);

-- Termin-Funnel
create index if not exists idx_setting_calls_lead_name_trgm
  on public.setting_calls using gin (lead_name gin_trgm_ops);
create index if not exists idx_setting_calls_company_trgm
  on public.setting_calls using gin (company gin_trgm_ops);
create index if not exists idx_closing_calls_lead_name_trgm
  on public.closing_calls using gin (lead_name gin_trgm_ops);
create index if not exists idx_closing_calls_company_trgm
  on public.closing_calls using gin (company gin_trgm_ops);
