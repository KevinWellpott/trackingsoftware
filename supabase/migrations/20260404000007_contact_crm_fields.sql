-- CRM fields for contacts that converted to appointments.

alter table public.contacts
  add column if not exists meeting_notes text,
  add column if not exists deal_closed boolean not null default false,
  add column if not exists deal_lost_reason text;

create index if not exists idx_contacts_workspace_appointment
  on public.contacts (workspace_id, appointment_set);
