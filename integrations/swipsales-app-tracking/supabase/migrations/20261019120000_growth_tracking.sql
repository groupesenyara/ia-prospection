-- SwipSales Growth — suivi des inscriptions, de l'activation et des abonnements
-- Migration additive : crée de nouvelles tables et vues, ne modifie aucune table existante.
-- Accès réservé au rôle service : RLS activée sans policy, droits retirés à anon / authenticated,
-- vues en security_invoker pour qu'elles ne contournent pas la RLS.

-- 1. Événements produit et paiement -------------------------------------------
create table if not exists public.growth_events (
  id               bigint generated always as identity primary key,
  event            text        not null check (event in (
                      'signup_completed',      -- compte créé (role = recruteur | candidat)
                      'profile_completed',     -- profil candidat ou fiche entreprise complète
                      'adn_test_completed',    -- test ADN terminé (candidat)
                      'job_published',         -- offre publiée (recruteur)
                      'search_performed',      -- recherche / filtre appliqué (recruteur)
                      'profile_viewed',        -- profil candidat consulté (recruteur)
                      'swipe',                 -- swipe (propriété direction)
                      'match_created',         -- match des deux côtés
                      'application_sent',      -- candidature envoyée
                      'message_sent',          -- premier message dans une conversation
                      'checkout_started',      -- ouverture du Checkout Stripe (intention, pas un paiement)
                      'checkout_completed',    -- retour Checkout (pas une preuve de paiement)
                      'payment_succeeded',     -- première facture d'abonnement payée (Stripe)
                      'subscription_renewed',  -- facture de renouvellement payée (Stripe)
                      'payment_failed',        -- facture échouée (Stripe)
                      'subscription_canceled'  -- abonnement terminé (Stripe)
                    )),
  user_id          uuid,
  role             text        check (role in ('recruteur','candidat') or role is null),
  properties       jsonb       not null default '{}'::jsonb,
  source           text        not null default 'app' check (source in ('app','stripe')),
  stripe_event_id  text        unique,
  occurred_at      timestamptz not null default now()
);
create index if not exists growth_events_event_time_idx on public.growth_events (event, occurred_at);
create index if not exists growth_events_user_idx on public.growth_events (user_id);

-- 2. Abonnements Stripe (miroir en lecture, alimenté par webhook) -------------
create table if not exists public.growth_stripe_subscriptions (
  subscription_id    text primary key,
  customer_id        text not null,
  user_id            uuid,
  audience           text not null default 'inconnu' check (audience in ('recruteur','candidat','inconnu')),
  status             text not null,
  price_id           text,
  plan_interval      text check (plan_interval in ('day','week','month','year')),
  interval_count     int  not null default 1,
  unit_amount_cents  int  not null default 0,
  quantity           int  not null default 1,
  discount_percent   numeric not null default 0,
  monthly_cents      int  not null default 0,   -- montant mensualisé HT, calculé côté webhook
  livemode           boolean not null default false,
  started_at         timestamptz,
  first_paid_at      timestamptz,               -- première facture payée : seule preuve de client payant
  canceled_at        timestamptz,
  ended_at           timestamptz,
  updated_at         timestamptz not null default now()
);
create index if not exists growth_subs_status_idx on public.growth_stripe_subscriptions (status);

alter table public.growth_events enable row level security;
alter table public.growth_stripe_subscriptions enable row level security;
revoke all on public.growth_events from anon, authenticated;
revoke all on public.growth_stripe_subscriptions from anon, authenticated;

-- 3. Vues de pilotage ---------------------------------------------------------
-- Client payant = abonnement en mode live, première facture payée, statut active.
create or replace view public.growth_v_paying_subscriptions with (security_invoker = true) as
select * from public.growth_stripe_subscriptions
where livemode and first_paid_at is not null and status = 'active';

create or replace view public.growth_v_mrr_now with (security_invoker = true) as
select
  audience,
  count(*)                                   as paying_subscriptions,
  round(sum(monthly_cents) / 100.0, 2)       as mrr_eur,
  round(avg(monthly_cents) / 100.0, 2)       as arpa_eur
from public.growth_v_paying_subscriptions
group by audience;

-- Indicateurs mensuels (mois civils, fuseau Europe/Paris)
create or replace view public.growth_v_monthly with (security_invoker = true) as
with months as (
  select generate_series(
    date_trunc('month', coalesce((select min(occurred_at) from public.growth_events), now()) at time zone 'Europe/Paris'),
    date_trunc('month', now() at time zone 'Europe/Paris'),
    interval '1 month')::date as month_start
),
ev as (
  select date_trunc('month', occurred_at at time zone 'Europe/Paris')::date as m, event, role
  from public.growth_events
),
subs as (select * from public.growth_stripe_subscriptions where livemode)
select
  mo.month_start,
  (select count(*) from ev where ev.m = mo.month_start and event = 'signup_completed' and role = 'recruteur')  as signups_recruteurs,
  (select count(*) from ev where ev.m = mo.month_start and event = 'signup_completed' and role = 'candidat')   as signups_candidats,
  (select count(*) from ev where ev.m = mo.month_start and event = 'profile_completed' and role = 'candidat')  as profils_candidats_completes,
  (select count(*) from subs where date_trunc('month', first_paid_at at time zone 'Europe/Paris')::date = mo.month_start) as nouveaux_payants,
  (select count(*) from subs where date_trunc('month', first_paid_at at time zone 'Europe/Paris')::date = mo.month_start and audience = 'recruteur') as nouveaux_payants_recruteurs,
  (select count(*) from subs where date_trunc('month', ended_at at time zone 'Europe/Paris')::date = mo.month_start and first_paid_at is not null) as resiliations,
  (select count(*) from subs
     where first_paid_at < (mo.month_start::timestamp at time zone 'Europe/Paris')
       and (ended_at is null or ended_at >= (mo.month_start::timestamp at time zone 'Europe/Paris'))) as payants_debut_de_mois
from months mo
order by mo.month_start;

comment on view public.growth_v_mrr_now is 'MRR actuel : somme des montants mensualisés HT des abonnements live, actifs, avec première facture payée.';
comment on view public.growth_v_monthly is 'Inscriptions, complétion, nouveaux payants, résiliations et base de début de mois, par mois civil (Europe/Paris).';

revoke all on public.growth_v_paying_subscriptions, public.growth_v_mrr_now, public.growth_v_monthly from anon, authenticated;
