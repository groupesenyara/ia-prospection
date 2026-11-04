-- Agent de prospection : détection des entreprises qui recrutent des commerciaux (France Travail),
-- fiche légale (registre public des entreprises) et dossier de recherche web sourcé par l'IA.
-- Règles portées par la base :
--   * une entreprise n'existe qu'une fois par SIREN ;
--   * chaque coordonnée reste soumise à `coordonnees_sourcees` (source obligatoire) ;
--   * une entreprise en opposition n'est plus jamais recherchée.

alter table public.prospects
  add column siren           text check (siren is null or siren ~ '^\d{9}$'),
  add column city            text not null default '',
  add column headcount       text not null default '',
  add column naf             text not null default '',
  add column origin          text not null default 'manuel',
  add column research        jsonb,
  add column research_status text not null default '' check (research_status in ('', 'à rechercher', 'en cours', 'fait', 'échec')),
  add column researched_at   timestamptz,
  add constraint pas_de_recherche_si_opposition check (not (opt_out and research_status in ('à rechercher', 'en cours')));
create unique index prospects_siren_key on public.prospects (siren) where siren is not null;
create index prospects_research_idx on public.prospects (research_status) where research_status = 'à rechercher';

-- Offres d'emploi commerciales repérées : le signal d'achat, daté et sourcé.
create table public.job_signals (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,
  external_id  text not null,
  prospect_id  uuid references public.prospects (id) on delete cascade,
  company      text not null,
  title        text not null,
  rome         text not null default '',
  contract     text not null default '',
  city         text not null default '',
  published_at date,
  url          text not null default '',
  excerpt      text not null default '',
  created_at   timestamptz not null default now(),
  unique (source, external_id)
);
create index job_signals_prospect_idx on public.job_signals (prospect_id);

alter table public.job_signals enable row level security;
create policy job_signals_read   on public.job_signals for select to authenticated using (public.is_team());
create policy job_signals_insert on public.job_signals for insert to authenticated with check (public.can_edit());
create policy job_signals_update on public.job_signals for update to authenticated using (public.can_edit()) with check (public.can_edit());
create policy job_signals_delete on public.job_signals for delete to authenticated using (public.is_owner());
revoke all on public.job_signals from anon;
