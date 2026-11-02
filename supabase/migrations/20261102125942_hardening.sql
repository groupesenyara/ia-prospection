-- Durcissement signalé par les conseillers de sécurité Supabase + activation du Realtime.

-- search_path figé sur toutes les fonctions (lint 0011).
alter function public.is_team()           set search_path = public;
alter function public.can_edit()          set search_path = public;
alter function public.is_owner()          set search_path = public;
alter function public.guard_campaign()    set search_path = public;
alter function public.guard_interaction() set search_path = public;
alter function public.guard_content()     set search_path = public;
alter function public.guard_outbox()      set search_path = public;
alter function public.touch_updated_at()  set search_path = public;

-- team_role() (security definer) : plus appelable sans connexion (lint 0028).
-- Les utilisateurs connectés en ont besoin pour évaluer les policies ; elle ne renvoie que leur propre rôle.
revoke execute on function public.team_role(), public.is_team(), public.can_edit(), public.is_owner() from public, anon;
grant  execute on function public.team_role(), public.is_team(), public.can_edit(), public.is_owner() to authenticated;

-- Realtime sur les tables suivies en direct par l'interface (la RLS s'applique aux abonnements).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['prospects','interactions','campaigns','content','outbox'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
