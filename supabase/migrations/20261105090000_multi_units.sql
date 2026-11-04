-- Plateforme commerciale multi-pôles du Groupe Senyara : Swipe Sales, Amandis School, North Reef.
-- Principe : UN SEUL CRM. Une entreprise = une fiche (`prospects`), et chaque pôle y suit sa propre opportunité.
-- Migration additive : rien n'est supprimé, Swipe Sales continue de fonctionner sans changement.
-- Retour arrière : supabase/rollback/20261105090000_multi_units_down.sql
--
-- Règles portées par la base :
--   * une entreprise n'a qu'une opportunité ouverte par pôle ;
--   * une entreprise n'est sollicitée activement que par UN pôle à la fois (pas de démarchage en rafale) ;
--   * aucune opportunité active pour une entreprise en opposition ;
--   * seul l'owner confirme un fait commercial (offre, tarif, certification, référence) : l'IA n'utilise que le confirmé ;
--   * une coordonnée de contact a toujours une source.

-- Pôles ---------------------------------------------------------------------------------------
create table public.business_units (
  id      text primary key check (id ~ '^[a-z]+$'),
  name    text not null,
  tagline text not null default '',
  active  boolean not null default true,
  goals   jsonb not null default '{}'::jsonb, -- objectifs mensuels : {"meetings": 8, "won": 2, "revenue": 5000}
  sort    int not null default 0
);
insert into public.business_units (id, name, tagline, sort) values
  ('swipsales', 'Swipe Sales', 'SaaS de recrutement des profils commerciaux', 1),
  ('amandis', 'Amandis School', 'Formation : IA, nouveaux métiers, compétences commerciales', 2),
  ('northreef', 'North Reef', 'Développement web, applications, logiciels, agents IA et automatisation', 3);

-- Faits commerciaux par pôle : seul le « Confirmé » est utilisé par l'IA ----------------------------
create table public.unit_facts (
  id           uuid primary key default gen_random_uuid(),
  unit         text not null references public.business_units (id),
  kind         text not null check (kind in ('offre', 'tarif', 'argument', 'reference', 'certification', 'interdit', 'cible')),
  text         text not null check (length(text) > 0),
  status       text not null default 'À vérifier' check (status in ('Confirmé', 'À vérifier')),
  source       text not null default '',
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  updated_at   timestamptz not null default now()
);
create index unit_facts_unit_idx on public.unit_facts (unit, status);

create or replace function public.guard_unit_fact() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'Confirmé' and (tg_op = 'INSERT' or old.status <> 'Confirmé' or new.text is distinct from old.text) then
    if auth.uid() is not null and not public.is_owner() then raise exception 'Seul Yannis (owner) confirme un fait commercial'; end if;
    new.confirmed_at := now(); new.confirmed_by := auth.uid();
  end if;
  if new.status = 'À vérifier' then new.confirmed_at := null; new.confirmed_by := null; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger unit_facts_guard before insert or update on public.unit_facts for each row execute function public.guard_unit_fact();

-- Reprise des faits produit existants (réglage « product ») dans le pôle Swipe Sales
insert into public.unit_facts (unit, kind, text, status, confirmed_at)
select 'swipsales', 'offre', f->>'text', case when f->>'status' = 'Confirmé' then 'Confirmé' else 'À vérifier' end,
       case when f->>'status' = 'Confirmé' then now() end
from public.settings s, jsonb_array_elements(coalesce(s.value->'facts', '[]'::jsonb)) f
where s.key = 'product' and coalesce(f->>'text', '') <> '';

-- Contacts : plusieurs interlocuteurs par entreprise ------------------------------------------
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  name        text not null default '',
  title       text not null default '',
  email       text not null default '',
  phone       text not null default '',
  linkedin    text not null default '',
  source      text not null default '',
  is_primary  boolean not null default false,
  opt_out     boolean not null default false,
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  constraint contact_source check ((email = '' and phone = '' and linkedin = '') or source <> ''),
  constraint contact_identifie check (name <> '' or email <> '' or phone <> '' or linkedin <> '')
);
create index contacts_prospect_idx on public.contacts (prospect_id);
create unique index contacts_one_primary on public.contacts (prospect_id) where is_primary;

insert into public.contacts (prospect_id, name, title, email, phone, linkedin, source, is_primary, opt_out)
select id, decision_name, decision_title, email, phone, linkedin,
       case when contact_source <> '' then contact_source when email = '' and phone = '' and linkedin = '' then '' else source end,
       true, opt_out
from public.prospects
where decision_name <> '' or email <> '' or phone <> '' or linkedin <> '';

-- Opportunités : une par entreprise et par pôle ---------------------------------------------------
create table public.opportunities (
  id             uuid primary key default gen_random_uuid(),
  prospect_id    uuid not null references public.prospects (id) on delete cascade,
  unit           text not null references public.business_units (id),
  stage          text not null default 'Entreprise identifiée',
  status         text not null default 'ouverte' check (status in ('ouverte', 'en attente', 'gagnée', 'perdue')),
  active         boolean not null default false, -- l'entreprise est en cours de sollicitation pour ce pôle
  score          int check (score between 0 and 100),
  crit           jsonb not null default '{}'::jsonb,
  offer          text not null default '', -- offre recommandée
  reason         text not null default '', -- pourquoi ce pôle, à partir de quels signaux
  need           text not null default '',
  signal         text not null default '',
  signal_source  text not null default '',
  signal_date    date,
  value_estimate numeric(12, 2) check (value_estimate is null or value_estimate >= 0),
  next_action    text not null default '',
  next_date      date,
  owner          uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint active_si_ouverte check (not active or status = 'ouverte'),
  constraint signal_source_requis check (signal = '' or signal_source <> '' or signal_date is null)
);
create unique index opportunities_one_open_per_unit on public.opportunities (prospect_id, unit) where status in ('ouverte', 'en attente');
create unique index opportunities_one_active on public.opportunities (prospect_id) where active;
create index opportunities_unit_idx on public.opportunities (unit, status);

create or replace function public.guard_opportunity() returns trigger language plpgsql set search_path = public as $$
begin
  if new.active and exists (select 1 from public.prospects where id = new.prospect_id and opt_out) then
    raise exception 'Cette entreprise a demandé à ne plus être contactée';
  end if;
  if new.active and exists (select 1 from public.opportunities o where o.prospect_id = new.prospect_id and o.active and o.id <> new.id) then
    raise exception 'Une autre activité sollicite déjà cette entreprise : mettez-la en attente avant d’en activer une nouvelle';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger opportunities_guard before insert or update on public.opportunities for each row execute function public.guard_opportunity();

-- Rattachement de l'existant à Swipe Sales ----------------------------------------------------
-- Valeur par défaut 'swipsales' : l'application actuelle continue d'écrire sans connaître les pôles.
alter table public.interactions add column unit text not null default 'swipsales' references public.business_units (id),
                                add column opportunity_id uuid references public.opportunities (id) on delete set null;
alter table public.outbox       add column unit text not null default 'swipsales' references public.business_units (id),
                                add column opportunity_id uuid references public.opportunities (id) on delete set null;
alter table public.campaigns    add column unit text not null default 'swipsales' references public.business_units (id);
alter table public.content      add column unit text not null default 'swipsales' references public.business_units (id);
alter table public.ai_usage     add column unit text references public.business_units (id);
alter table public.team_members add column units text[] not null default array['swipsales', 'amandis', 'northreef'];
alter table public.prospects    add column assigned_by text not null default 'legacy'; -- 'legacy' : pipeline Swipe Sales historique ; 'orchestrateur' : pôles choisis par l'IA

-- Pipeline Swipe Sales : `prospects.stage` reste la source pendant la transition, l'opportunité suit.
create or replace function public.swipsales_status(stage text) returns text language sql immutable as $$
  select case when stage in ('Client payant', 'Abonnement commencé') then 'gagnée' when stage = 'Client perdu' then 'perdue' else 'ouverte' end
$$;
create or replace function public.swipsales_active(stage text) returns boolean language sql immutable as $$
  select stage in ('À contacter', 'Contact effectué', 'Réponse reçue', 'Rendez-vous planifié', 'Démonstration réalisée', 'Offre présentée', 'Essai Founding en cours')
$$;

create or replace function public.sync_swipsales_opportunity() returns trigger language plpgsql security definer set search_path = public as $$
declare
  st text := public.swipsales_status(new.stage);
  act boolean := public.swipsales_active(new.stage) and not new.opt_out and st = 'ouverte'
                 and not exists (select 1 from public.opportunities o where o.prospect_id = new.id and o.active and o.unit <> 'swipsales');
begin
  if new.assigned_by <> 'legacy' then return new; end if;
  update public.opportunities set
    stage = new.stage, status = st, active = act, crit = coalesce(new.crit, '{}'::jsonb), need = new.need,
    signal = new.signal, signal_source = new.signal_source, signal_date = new.signal_date,
    next_action = new.next_action, next_date = new.next_date
  where prospect_id = new.id and unit = 'swipsales' and status in ('ouverte', 'en attente', 'gagnée', 'perdue')
    and id = (select id from public.opportunities where prospect_id = new.id and unit = 'swipsales' order by created_at desc limit 1);
  if not found then
    insert into public.opportunities (prospect_id, unit, stage, status, active, crit, need, signal, signal_source, signal_date, next_action, next_date)
    values (new.id, 'swipsales', new.stage, st, act, coalesce(new.crit, '{}'::jsonb), new.need, new.signal, new.signal_source, new.signal_date, new.next_action, new.next_date);
  end if;
  return new;
end $$;
create trigger prospects_sync_swipsales after insert or update of stage, opt_out, crit, need, signal, signal_source, signal_date, next_action, next_date
  on public.prospects for each row execute function public.sync_swipsales_opportunity();

-- Opportunité Swipe Sales pour chaque fiche existante (sans toucher aux fiches)
insert into public.opportunities (prospect_id, unit, stage, status, active, crit, need, signal, signal_source, signal_date, next_action, next_date)
select id, 'swipsales', stage, public.swipsales_status(stage), public.swipsales_active(stage) and not opt_out and public.swipsales_status(stage) = 'ouverte',
       coalesce(crit, '{}'::jsonb), need, signal, signal_source, signal_date, next_action, next_date
from public.prospects;

-- Un contact journalisé pour un pôle est refusé si un AUTRE pôle sollicite déjà l'entreprise.
create or replace function public.guard_interaction() returns trigger language plpgsql set search_path = public as $$
declare other text;
begin
  if new.type like 'contact_%' and exists (select 1 from public.prospects where id = new.prospect_id and opt_out) then
    raise exception 'Cette entreprise a demandé à ne plus être contactée';
  end if;
  if new.type like 'contact_%' then
    select b.name into other from public.opportunities o join public.business_units b on b.id = o.unit
    where o.prospect_id = new.prospect_id and o.active and o.unit <> new.unit limit 1;
    if other is not null then
      raise exception 'Cette entreprise est déjà sollicitée par %. Une seule activité à la fois : mettez l’autre opportunité en attente.', other;
    end if;
  end if;
  return new;
end $$;

-- Missions confiées à l'orchestrateur ------------------------------------------------------------
create table public.missions (
  id         uuid primary key default gen_random_uuid(),
  request    text not null check (length(request) between 3 and 1000),
  plan       jsonb,
  status     text not null default 'à planifier' check (status in ('à planifier', 'en cours', 'terminée', 'échec', 'annulée')),
  results    jsonb not null default '[]'::jsonb,
  cost       jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger missions_touch before update on public.missions for each row execute function public.touch_updated_at();

-- Sécurité : mêmes règles que le reste du CRM ---------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['unit_facts', 'contacts', 'opportunities', 'missions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_team())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit()) with check (public.can_edit())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_owner())', t || '_delete', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
alter table public.business_units enable row level security;
create policy business_units_read on public.business_units for select to authenticated using (public.is_team());
create policy business_units_write on public.business_units for update to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on public.business_units from anon;
revoke execute on function public.sync_swipsales_opportunity() from public, anon, authenticated;

-- Temps réel : les nouvelles tables suivies par l'interface
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['opportunities', 'contacts', 'missions'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
