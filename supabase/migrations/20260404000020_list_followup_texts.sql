-- Follow-up-Texte je Pitch-Liste.
--
-- Der Pitch-Text hängt an der Liste (`lists.pitch_text`) — die zugehörige
-- Nachfass-Sequenz gehört fachlich zum selben Satz, damit sich Pitch-Varianten
-- als Ganzes vergleichen lassen. Die bestehenden nutzerweiten Vorlagen
-- (`followup_templates`) bleiben als Fallback: Listen-Text > Nutzer-Vorlage >
-- Standardtext (siehe followUpTextFor in src/app/actions/nachfassen.ts).

alter table public.lists
  add column if not exists fu1_text text,
  add column if not exists fu2_text text,
  add column if not exists fu3_text text;

notify pgrst, 'reload schema';
