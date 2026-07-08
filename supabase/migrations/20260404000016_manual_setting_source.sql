-- Manuelle Termine (Social Selling / alte Kontakte / WhatsApp): ein Setting-Call
-- soll ohne LinkedIn-Kontakt und ohne Telefon-Lead buchbar sein. source_contact_id
-- und source_phone_lead_id sind bereits nullable — es fehlt nur der erlaubte
-- source_type-Wert 'manuell', damit solche Termine als eigene Quelle zählen.

alter table public.setting_calls
  drop constraint if exists setting_calls_source_type_check;

alter table public.setting_calls
  add constraint setting_calls_source_type_check
  check (
    source_type is null
    or source_type in ('linkedin', 'telefon', 'inbound', 'website', 'manuell')
  );
