-- Freitext-Quelle für (v. a. manuelle) Termine: woher der Lead konkret kam,
-- z. B. "Social Selling", "alter Kontakt (WhatsApp)", "Empfehlung Max Muster".
-- Ergänzt das grobe source_type ('manuell') um eine feinere, frei eingebbare Angabe.

alter table public.setting_calls
  add column if not exists source_detail text;
