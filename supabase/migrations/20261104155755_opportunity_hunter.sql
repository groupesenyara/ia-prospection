-- Opportunity Hunter : veille des demandes de prestations publiées (marchés publics, plateformes de mise en relation)
-- et réponse assistée. Intégré au CRM existant : une annonce retenue se rattache à une fiche entreprise (prospects)
-- et à une opportunité de pôle (opportunities). Migration additive. Retour arrière : supabase/rollback/20261104155755_opportunity_hunter_down.sql
--
-- Règles portées par la base :
--   * une annonce n'est enregistrée qu'une fois par source (anti-doublon) ;
--   * une proposition n'est marquée envoyée qu'après validation ;
--   * seul l'owner valide une proposition ;
--   * l'envoi automatique est impossible tant qu'aucune plateforme ne l'autorise (aucune valeur « envoyée auto »).

create table public.hunter_items (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('boamp', 'codeur', 'malt', 'comeup', 'linkedin', 'rss', 'manuel')),
  external_id     text not null,
  url             text not null default '',
  title           text not null,
  description     text not null default '',
  buyer           text not null default '', -- entreprise ou acheteur public
  contact         text not null default '',
  published_at    date,
  detected_at     timestamptz not null default now(),
  deadline        date, -- date limite de réponse
  budget_min      numeric(12, 2) check (budget_min is null or budget_min >= 0),
  budget_max      numeric(12, 2) check (budget_max is null or budget_max >= 0),
  budget_text     text not null default '',
  unit            text references public.business_units (id),
  service_type    text not null default '',
  sector          text not null default '',
  score           int check (score between 0 and 100),
  priority        text not null default 'à analyser' check (priority in ('à analyser', 'très élevée', 'élevée', 'à étudier', 'non pertinente')),
  analysis        jsonb not null default '{}'::jsonb,
  reference       text not null default '', -- référence client proposée (faits confirmés uniquement)
  proposal        text not null default '',
  proposal_issues jsonb not null default '[]'::jsonb, -- affirmations non couvertes par un fait confirmé
  validation      text not null default 'à rédiger' check (validation in ('à rédiger', 'à valider', 'validée', 'rejetée')),
  validated_by    uuid references auth.users (id),
  validated_at    timestamptz,
  send_status     text not null default 'non envoyée' check (send_status in ('non envoyée', 'envoyée manuellement')),
  sent_at         timestamptz,
  follow_up_date  date,
  outcome         text not null default 'en cours' check (outcome in ('en cours', 'réponse', 'rendez-vous', 'gagné', 'perdu', 'sans suite')),
  won_amount      numeric(12, 2) check (won_amount is null or won_amount >= 0),
  prospect_id     uuid references public.prospects (id) on delete set null,
  opportunity_id  uuid references public.opportunities (id) on delete set null,
  updated_at      timestamptz not null default now(),
  unique (source, external_id),
  constraint envoi_apres_validation check (send_status = 'non envoyée' or validation = 'validée'),
  constraint proposition_sans_alerte check (validation <> 'validée' or jsonb_array_length(proposal_issues) = 0)
);
create index hunter_items_priority_idx on public.hunter_items (priority, detected_at desc);
create index hunter_items_unit_idx on public.hunter_items (unit);

create or replace function public.guard_hunter_item() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.proposal is distinct from old.proposal and old.send_status <> 'non envoyée' then
    raise exception 'Proposition déjà envoyée : elle ne peut plus être modifiée';
  end if;
  if tg_op = 'UPDATE' and new.proposal is distinct from old.proposal and new.validation = 'validée' and old.validation = 'validée' then
    new.validation := 'à valider'; new.validated_at := null; new.validated_by := null; -- proposition modifiée : à revalider
  end if;
  if new.validation = 'validée' and (tg_op = 'INSERT' or old.validation <> 'validée') then
    if auth.uid() is not null and not public.is_owner() then raise exception 'Seul Yannis (owner) valide une proposition'; end if;
    new.validated_at := now(); new.validated_by := auth.uid();
  end if;
  if new.send_status = 'envoyée manuellement' and (tg_op = 'INSERT' or old.send_status <> new.send_status) then new.sent_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger hunter_items_guard before insert or update on public.hunter_items for each row execute function public.guard_hunter_item();

-- Journal des actions (détection, analyse, rédaction, validation, envoi, arrêt d'urgence)
create table public.hunter_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  action  text not null,
  item_id uuid references public.hunter_items (id) on delete set null,
  detail  text not null default '',
  by_user uuid default auth.uid()
);
create index hunter_log_at_idx on public.hunter_log (at desc);

do $$
declare t text;
begin
  foreach t in array array['hunter_items', 'hunter_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_team())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit()) with check (public.can_edit())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_owner())', t || '_delete', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.hunter_items';
  end if;
end $$;
