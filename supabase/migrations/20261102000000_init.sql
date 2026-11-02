-- SwipSales Growth — schéma initial
-- Règles métier portées par la base (et pas seulement par l'interface) :
--   * seul un membre « owner » (Yannis) valide une campagne, une publication ou un envoi ;
--   * une campagne validée puis modifiée repasse en brouillon ;
--   * « Client payant » exige un abonnement Stripe sub_… vérifié ;
--   * aucune interaction de contact avec une entreprise en opposition (opt_out) ;
--   * aucune publication validée qui cite une entreprise sans son accord écrit ;
--   * rien n'est envoyé sans validation.

-- gen_random_uuid() est natif depuis Postgres 13.

-- Équipe -----------------------------------------------------------------------
create table public.team_members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role         text not null check (role in ('owner', 'editor', 'viewer'))
);

create or replace function public.team_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.team_members where user_id = auth.uid()
$$;
create or replace function public.is_team() returns boolean language sql stable as $$ select public.team_role() is not null $$;
create or replace function public.can_edit() returns boolean language sql stable as $$ select public.team_role() in ('owner', 'editor') $$;
create or replace function public.is_owner() returns boolean language sql stable as $$ select public.team_role() = 'owner' $$;

-- Campagnes --------------------------------------------------------------------
create table public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  segment      text not null default '' check (segment in ('', 'A', 'B', 'C')),
  goal         text not null default '',
  angle        text not null default '',
  cta          text not null default '',
  daily_cap    int  not null default 20 check (daily_cap between 1 and 50),
  status       text not null default 'Brouillon' check (status in ('Brouillon', 'Validée', 'En pause', 'Terminée')),
  validated_at timestamptz,
  validated_by uuid references auth.users (id),
  steps        jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

-- Prospects (entreprises, partenaires, grands comptes) ---------------------------
create table public.prospects (
  id                 uuid primary key default gen_random_uuid(),
  company            text not null,
  website            text not null default '',
  sector             text not null default '',
  size               text not null default 'Inconnue',
  kind               text not null default 'Entreprise qui recrute',
  roles              text not null default '',
  source             text not null check (length(source) > 0),
  verified_at        date not null default current_date,
  decision_name      text not null default '',
  decision_title     text not null default '',
  decision_verified  boolean not null default false,
  email              text not null default '',
  linkedin           text not null default '',
  phone              text not null default '',
  contact_source     text not null default '',
  signal             text not null default '',
  signal_source      text not null default '',
  signal_date        date,
  need               text not null default '',
  crit               jsonb not null default '{}'::jsonb,
  stage              text not null default 'Entreprise identifiée',
  next_action        text not null default '',
  next_date          date,
  stripe_sub_id      text not null default '',
  stripe_verified    boolean not null default false,
  opt_out            boolean not null default false,
  notes              text not null default '',
  segment            text not null default '' check (segment in ('', 'A', 'B', 'C')),
  comms_consent      boolean not null default false,
  comms_consent_date date,
  partner_status     text not null default 'Identifié',
  partner_model      text not null default '',
  convention_ok      boolean not null default false,
  partner_notes      text not null default '',
  trial_start        date,
  trial_end          date,
  engagement_ok      boolean not null default false,
  offer_published    boolean not null default false,
  offer_date         date,
  feedback_score     int check (feedback_score between 0 and 10),
  feedback_notes     text not null default '',
  reference_ok       boolean not null default false,
  campaign_id        uuid references public.campaigns (id) on delete set null,
  enrolled_at        date,
  campaign_state     text not null default '',
  drafts             jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint client_payant_verifie check (stage <> 'Client payant' or (stripe_verified and stripe_sub_id ~ '^sub_[A-Za-z0-9]+$')),
  constraint coordonnees_sourcees check ((email = '' and phone = '' and linkedin = '') or contact_source <> ''),
  constraint essai_segment_b check (trial_start is null or (segment = 'B' and engagement_ok))
);
create index prospects_next_date_idx on public.prospects (next_date);
create index prospects_segment_idx on public.prospects (segment);

-- Interactions (historique commun à tous les canaux) ----------------------------
create table public.interactions (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  at          timestamptz not null default now(),
  day         date not null default current_date,
  type        text not null check (type in ('contact_email', 'contact_linkedin', 'contact_appel', 'contact_whatsapp', 'reponse', 'rdv', 'demo', 'offre', 'objection', 'note')),
  channel     text,
  note        text not null default '',
  objection   text,
  campaign_id uuid references public.campaigns (id) on delete set null,
  created_by  uuid references auth.users (id) default auth.uid(),
  constraint objection_renseignee check (type <> 'objection' or coalesce(objection, '') <> '')
);
create index interactions_prospect_idx on public.interactions (prospect_id, at);

-- File d'envoi : rien ne part sans validation -------------------------------
create table public.outbox (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.prospects (id) on delete cascade,
  campaign_id  uuid references public.campaigns (id) on delete set null,
  step_index   int,
  channel      text not null check (channel in ('E-mail', 'LinkedIn', 'WhatsApp', 'Téléphone')),
  subject      text not null default '',
  body         text not null,
  status       text not null default 'À valider' check (status in ('À valider', 'Validé', 'Envoyé', 'Annulé', 'Échec')),
  validated_by uuid references auth.users (id),
  validated_at timestamptz,
  sent_at      timestamptz,
  error        text,
  created_at   timestamptz not null default now(),
  constraint envoi_valide check (status not in ('Validé', 'Envoyé') or validated_at is not null),
  constraint envoi_automatique_email check (status <> 'Envoyé' or channel in ('E-mail', 'LinkedIn', 'WhatsApp', 'Téléphone'))
);

-- Communication ------------------------------------------------------------
create table public.content (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  networks    text[] not null default '{}',
  format      text not null default '',
  target      text not null default 'Recruteur',
  hook        text not null default '',
  text        text not null default '',
  cta         text not null default '',
  status      text not null default 'Idée' check (status in ('Idée', 'Brouillon', 'À valider', 'Validé', 'Publié')),
  date        date,
  prospect_id uuid references public.prospects (id) on delete set null,
  kind        text not null default '',
  updated_at  timestamptz not null default now()
);

-- Mesures, coûts, expériences, retours, réglages -------------------------------
create table public.metric_snapshots (
  period      text primary key check (period ~ '^\d{4}-\d{2}$'),
  source      text not null check (length(source) > 0),
  method      text not null default 'saisie manuelle',
  recorded_at date not null default current_date,
  values      jsonb not null default '{}'::jsonb
);
create table public.spend (
  id      uuid primary key default gen_random_uuid(),
  date    date not null,
  channel text not null,
  amount  numeric(10, 2) not null check (amount >= 0),
  note    text not null default ''
);
create table public.experiments (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  hypothesis text not null,
  target     text not null default '',
  channel    text not null default '',
  budget     numeric(10, 2) not null default 0,
  validated  boolean not null default false,
  days       int,
  start      date,
  metric     text not null default '',
  threshold  text not null default '',
  status     text not null default 'Proposée' check (status in ('Proposée', 'Validée', 'En cours', 'Terminée')),
  result     text not null default '',
  decision   text not null default '',
  constraint budget_valide check (budget = 0 or status in ('Proposée', 'Terminée') or validated),
  constraint decision_finale check (status <> 'Terminée' or decision <> '')
);
create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  detail     text not null default '',
  source     text not null default '',
  stage      text not null default 'Autre',
  status     text not null default 'Ouvert',
  created_at date not null default current_date
);
create table public.settings (
  key   text primary key,          -- 'product', 'integrations', 'services'
  value jsonb not null
);
create table public.ai_usage (
  id         bigint generated always as identity primary key,
  day        date not null default current_date,
  user_id    uuid default auth.uid(),
  kind       text not null,
  tokens_in  int not null default 0,
  tokens_out int not null default 0
);

-- Déclencheurs de règles ------------------------------------------------------
create or replace function public.guard_campaign() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status = 'Validée' and new.status = 'Validée'
     and (new.name, new.segment, new.goal, new.angle, new.cta, new.daily_cap, new.steps)
         is distinct from (old.name, old.segment, old.goal, old.angle, old.cta, old.daily_cap, old.steps) then
    new.status := 'Brouillon'; new.validated_at := null; new.validated_by := null;
  end if;
  if new.status = 'Validée' and (tg_op = 'INSERT' or old.status <> 'Validée') then
    if not public.is_owner() then raise exception 'Seul Yannis (owner) peut valider une campagne'; end if;
    new.validated_at := now(); new.validated_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger campaigns_guard before insert or update on public.campaigns for each row execute function public.guard_campaign();

create or replace function public.guard_interaction() returns trigger language plpgsql as $$
begin
  if new.type like 'contact_%' and exists (select 1 from public.prospects where id = new.prospect_id and opt_out) then
    raise exception 'Cette entreprise a demandé à ne plus être contactée';
  end if;
  return new;
end $$;
create trigger interactions_guard before insert on public.interactions for each row execute function public.guard_interaction();

create or replace function public.guard_content() returns trigger language plpgsql as $$
begin
  if new.status in ('Validé', 'Publié') and (tg_op = 'INSERT' or old.status not in ('Validé', 'Publié')) then
    if not public.is_owner() then raise exception 'Seul Yannis (owner) peut valider une publication'; end if;
    if new.prospect_id is not null and not exists (select 1 from public.prospects where id = new.prospect_id and comms_consent) then
      raise exception 'Pas d''accord écrit de l''entreprise citée';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger content_guard before insert or update on public.content for each row execute function public.guard_content();

create or replace function public.guard_outbox() returns trigger language plpgsql as $$
begin
  if new.status = 'Validé' and (tg_op = 'INSERT' or old.status <> 'Validé') then
    if not public.is_owner() then raise exception 'Seul Yannis (owner) peut valider un envoi'; end if;
    new.validated_at := now(); new.validated_by := auth.uid();
  end if;
  if new.status = 'Envoyé' and exists (select 1 from public.prospects where id = new.prospect_id and opt_out) then
    raise exception 'Envoi refusé : opposition de l''entreprise';
  end if;
  return new;
end $$;
create trigger outbox_guard before insert or update on public.outbox for each row execute function public.guard_outbox();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger prospects_touch before update on public.prospects for each row execute function public.touch_updated_at();

-- Sécurité : RLS ----------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['campaigns','prospects','interactions','outbox','content','metric_snapshots','spend','experiments','feedback','settings','ai_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_team())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit()) with check (public.can_edit())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_owner())', t || '_delete', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
alter table public.team_members enable row level security;
create policy team_read on public.team_members for select to authenticated using (public.is_team());
revoke all on public.team_members from anon;
