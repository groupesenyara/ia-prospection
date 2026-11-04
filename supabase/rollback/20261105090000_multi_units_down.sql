-- Retour arrière de 20261105090000_multi_units.sql.
-- ATTENTION : supprime les opportunités, contacts, faits par pôle et missions saisis depuis la migration.
-- Les fiches entreprises, interactions, campagnes et envois sont conservés (seules les colonnes de pôle sont retirées).
-- À exécuter uniquement après validation de Yannis, et après un export des tables concernées.
begin;
drop trigger if exists prospects_sync_swipsales on public.prospects;
drop function if exists public.sync_swipsales_opportunity();
drop function if exists public.swipsales_status(text);
drop function if exists public.swipsales_active(text);

-- Règle d'interaction d'origine
create or replace function public.guard_interaction() returns trigger language plpgsql set search_path = public as $$
begin
  if new.type like 'contact_%' and exists (select 1 from public.prospects where id = new.prospect_id and opt_out) then
    raise exception 'Cette entreprise a demandé à ne plus être contactée';
  end if;
  return new;
end $$;

alter table public.interactions drop column if exists opportunity_id, drop column if exists unit;
alter table public.outbox       drop column if exists opportunity_id, drop column if exists unit;
alter table public.campaigns    drop column if exists unit;
alter table public.content      drop column if exists unit;
alter table public.ai_usage     drop column if exists unit;
alter table public.team_members drop column if exists units;
alter table public.prospects    drop column if exists assigned_by;

drop table if exists public.missions;
drop table if exists public.opportunities;
drop function if exists public.guard_opportunity();
drop table if exists public.contacts;
drop table if exists public.unit_facts;
drop function if exists public.guard_unit_fact();
drop table if exists public.business_units;
commit;
