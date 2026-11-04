-- Retour arrière de 20261104155755_opportunity_hunter.sql. Supprime les annonces et le journal de l'Opportunity Hunter.
-- Les fiches entreprises et opportunités créées depuis une annonce sont conservées.
begin;
drop table if exists public.hunter_log;
drop table if exists public.hunter_items;
drop function if exists public.guard_hunter_item();
delete from public.settings where key in ('hunter', 'hunter_report');
commit;
