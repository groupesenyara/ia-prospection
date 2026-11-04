-- Conseiller de sécurité Supabase (lint 0011) : search_path figé sur les fonctions ajoutées par multi_units.
alter function public.swipsales_status(text) set search_path = public;
alter function public.swipsales_active(text) set search_path = public;
