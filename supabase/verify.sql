-- Vérification des migrations (init, hardening, prospecting, multi_units) sur le projet Supabase.
-- À coller dans l'éditeur SQL (Supabase > SQL Editor). Lecture seule : ne modifie rien.
-- Chaque ligne doit afficher ok = true.

with
expected_tables(t) as (values
  ('team_members'),('campaigns'),('prospects'),('interactions'),('outbox'),('content'),
  ('metric_snapshots'),('spend'),('experiments'),('feedback'),('settings'),('ai_usage'),
  ('job_signals'),('business_units'),('unit_facts'),('contacts'),('opportunities'),('missions')),
expected_functions(f) as (values
  ('team_role'),('is_team'),('can_edit'),('is_owner'),
  ('guard_campaign'),('guard_interaction'),('guard_content'),('guard_outbox'),('touch_updated_at')),
expected_triggers(tg, tbl) as (values
  ('campaigns_guard','campaigns'),('interactions_guard','interactions'),('content_guard','content'),
  ('outbox_guard','outbox'),('prospects_touch','prospects')),
expected_constraints(c) as (values
  ('client_payant_verifie'),('coordonnees_sourcees'),('essai_segment_b'),('objection_renseignee'),
  ('envoi_valide'),('budget_valide'),('decision_finale')),
realtime_tables(t) as (values ('prospects'),('interactions'),('campaigns'),('content'),('outbox'))
select '1. tables présentes' as controle,
       (select count(*) from expected_tables e join pg_tables p on p.schemaname = 'public' and p.tablename = e.t) = 18 as ok,
       (select string_agg(t, ', ') from expected_tables e where not exists (select 1 from pg_tables p where p.schemaname = 'public' and p.tablename = e.t)) as manquants
union all
select '2. RLS activée partout',
       not exists (select 1 from expected_tables e join pg_class c on c.relname = e.t and c.relnamespace = 'public'::regnamespace where not c.relrowsecurity),
       (select string_agg(e.t, ', ') from expected_tables e join pg_class c on c.relname = e.t and c.relnamespace = 'public'::regnamespace where not c.relrowsecurity)
union all
select '3. policies (67 attendues)',
       (select count(*) from pg_policies where schemaname = 'public') = 67,
       (select count(*)::text || ' trouvées' from pg_policies where schemaname = 'public')
union all
select '4. fonctions',
       (select count(distinct proname) from pg_proc join expected_functions on proname = f where pronamespace = 'public'::regnamespace) = 9,
       (select string_agg(f, ', ') from expected_functions where not exists (select 1 from pg_proc where proname = f and pronamespace = 'public'::regnamespace))
union all
select '5. déclencheurs de règles',
       (select count(*) from expected_triggers e join pg_trigger t on t.tgname = e.tg and t.tgrelid = ('public.' || e.tbl)::regclass) = 5,
       (select string_agg(tg, ', ') from expected_triggers e where not exists (select 1 from pg_trigger t where t.tgname = e.tg))
union all
select '6. contraintes métier',
       (select count(*) from expected_constraints e join pg_constraint c on c.conname = e.c and c.connamespace = 'public'::regnamespace) = 7,
       (select string_agg(c, ', ') from expected_constraints e where not exists (select 1 from pg_constraint k where k.conname = e.c))
union all
select '7. anon sans aucun droit',
       not exists (select 1 from information_schema.role_table_grants g join expected_tables e on g.table_name = e.t where g.table_schema = 'public' and g.grantee = 'anon'),
       (select string_agg(distinct g.table_name, ', ') from information_schema.role_table_grants g join expected_tables e on g.table_name = e.t where g.table_schema = 'public' and g.grantee = 'anon')
union all
select '8. équipe déclarée (un owner)',
       exists (select 1 from public.team_members where role = 'owner'),
       (select coalesce(string_agg(display_name || ' (' || role || ')', ', '), 'table vide : étape 3 du README') from public.team_members)
union all
select '9. Realtime activé (5 tables)',
       (select count(*) from realtime_tables r join pg_publication_tables p on p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = r.t) = 5,
       (select string_agg(t, ', ') from realtime_tables r where not exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = r.t))
union all
select '10. migration enregistrée (supabase db push)',
       to_regclass('supabase_migrations.schema_migrations') is not null,
       'faux si la migration a été collée dans l''éditeur SQL : sans conséquence';
