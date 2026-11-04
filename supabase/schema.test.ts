// Teste la migration sur un vrai Postgres (PGlite) avec un faux schéma auth, comme sur Supabase.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const OWNER = "00000000-0000-0000-0000-000000000001";
const EDITOR = "00000000-0000-0000-0000-000000000002";
const OUTSIDER = "00000000-0000-0000-0000-000000000003";
let db: PGlite;

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  if (user) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
    await db.exec("set role authenticated");
  } else {
    await db.exec("set role anon");
  }
  try { return await db.query<any>(sql, params); } finally { await db.exec("reset role"); }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
  `);
  await db.exec(readFileSync(new URL("./migrations/20261102125807_init.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("./migrations/20261102125942_hardening.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("./migrations/20261104090000_prospecting.sql", import.meta.url), "utf8"));
  await db.exec(`
    grant usage on schema public to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    insert into auth.users values ('${OWNER}'), ('${EDITOR}'), ('${OUTSIDER}');
    insert into public.team_members values ('${OWNER}', 'Yannis', 'owner'), ('${EDITOR}', 'Joseph', 'editor');
  `);
});

describe("migration et règles", () => {
  it("un utilisateur hors équipe ne voit rien, anon n'a aucun droit", async () => {
    await as(EDITOR, `insert into prospects (company, source) values ('Acme', 'https://x')`);
    expect((await as(OUTSIDER, "select * from prospects")).rows).toHaveLength(0);
    await expect(as(null, "select * from prospects")).rejects.toThrow();
    expect((await as(EDITOR, "select * from prospects")).rows).toHaveLength(1);
  });

  it("seul l'owner valide une campagne ; modifiée, elle repasse en brouillon", async () => {
    await as(EDITOR, `insert into campaigns (id, name, segment, steps) values ('11111111-1111-1111-1111-111111111111', 'C', 'C', '[{"day":0,"channel":"E-mail","template":"x"}]')`);
    await expect(as(EDITOR, `update campaigns set status = 'Validée' where name = 'C'`)).rejects.toThrow(/owner/);
    await as(OWNER, `update campaigns set status = 'Validée' where name = 'C'`);
    let c = (await as(OWNER, "select status, validated_by from campaigns")).rows[0];
    expect(c).toMatchObject({ status: "Validée", validated_by: OWNER });
    await as(EDITOR, `update campaigns set angle = 'nouvel angle' where name = 'C'`);
    c = (await as(OWNER, "select status, validated_at from campaigns")).rows[0];
    expect(c).toMatchObject({ status: "Brouillon", validated_at: null });
  });

  it("client payant seulement avec abonnement Stripe vérifié ; coordonnées sourcées", async () => {
    await expect(as(EDITOR, `update prospects set stage = 'Client payant' where company = 'Acme'`)).rejects.toThrow(/client_payant_verifie/);
    await as(EDITOR, `update prospects set stage = 'Client payant', stripe_verified = true, stripe_sub_id = 'sub_123' where company = 'Acme'`);
    await expect(as(EDITOR, `insert into prospects (company, source, email) values ('B', 'x', 'a@b.fr')`)).rejects.toThrow(/coordonnees_sourcees/);
  });

  it("opposition : aucun contact ni envoi ; objection obligatoire", async () => {
    const id = (await as(EDITOR, `insert into prospects (company, source, opt_out) values ('Stop', 'x', true) returning id`)).rows[0].id;
    await expect(as(EDITOR, `insert into interactions (prospect_id, type) values ($1, 'contact_email')`, [id])).rejects.toThrow(/ne plus être contactée/);
    await as(EDITOR, `insert into interactions (prospect_id, type, note) values ($1, 'note', 'ok')`, [id]);
    await expect(as(EDITOR, `insert into interactions (prospect_id, type) values ($1, 'objection')`, [id])).rejects.toThrow(/objection_renseignee/);
  });

  it("envoi : validation par l'owner obligatoire", async () => {
    const pid = (await as(EDITOR, `select id from prospects where company = 'Acme'`)).rows[0].id;
    await expect(as(EDITOR, `insert into outbox (prospect_id, channel, body, status, sent_at) values ($1, 'E-mail', 'x', 'Envoyé', now())`, [pid])).rejects.toThrow(/envoi_valide/);
    const oid = (await as(EDITOR, `insert into outbox (prospect_id, channel, body) values ($1, 'E-mail', 'x') returning id`, [pid])).rows[0].id;
    await expect(as(EDITOR, `update outbox set status = 'Validé' where id = $1`, [oid])).rejects.toThrow(/owner/);
    await as(OWNER, `update outbox set status = 'Validé' where id = $1`, [oid]);
    expect((await as(OWNER, `select validated_by from outbox where id = $1`, [oid])).rows[0].validated_by).toBe(OWNER);
  });

  it("publication citant une entreprise : accord écrit requis", async () => {
    const pid = (await as(EDITOR, `select id from prospects where company = 'Acme'`)).rows[0].id;
    await as(EDITOR, `insert into content (title, status, prospect_id) values ('Bienvenue', 'À valider', $1)`, [pid]);
    await expect(as(OWNER, `update content set status = 'Validé' where title = 'Bienvenue'`)).rejects.toThrow(/accord/);
    await as(EDITOR, `update prospects set comms_consent = true where id = $1`, [pid]);
    await as(OWNER, `update content set status = 'Validé' where title = 'Bienvenue'`);
  });

  it("essai Founding : segment B et engagement ; expérience payante validée", async () => {
    await expect(as(EDITOR, `insert into prospects (company, source, trial_start) values ('T', 'x', current_date)`)).rejects.toThrow(/essai_segment_b/);
    await expect(as(EDITOR, `insert into experiments (title, hypothesis, budget, status) values ('Pub', 'h', 50, 'En cours')`)).rejects.toThrow(/budget_valide/);
  });

  it("suppression réservée à l'owner", async () => {
    await as(EDITOR, `delete from feedback`);
    await as(EDITOR, `insert into feedback (title) values ('Bug')`);
    await as(EDITOR, `delete from feedback where title = 'Bug'`);
    expect((await as(OWNER, `select count(*)::int as n from feedback`)).rows[0].n).toBe(1);
  });

  it("agent de prospection : un SIREN unique, pas de recherche en opposition, signaux réservés à l'équipe", async () => {
    const id = (await as(EDITOR, `insert into prospects (company, source, siren, origin, research_status) values ('Siren Co', 'https://ft', '123456789', 'france_travail', 'à rechercher') returning id`)).rows[0].id;
    await expect(as(EDITOR, `insert into prospects (company, source, siren) values ('Siren Bis', 'x', '123456789')`)).rejects.toThrow(/prospects_siren_key/);
    await expect(as(EDITOR, `insert into prospects (company, source, siren) values ('Mauvais', 'x', '12345')`)).rejects.toThrow(/siren_check/);
    await expect(as(EDITOR, `update prospects set opt_out = true where id = $1`, [id])).rejects.toThrow(/pas_de_recherche_si_opposition/);
    await as(EDITOR, `update prospects set opt_out = true, research_status = '' where id = $1`, [id]);
    await as(EDITOR, `insert into job_signals (source, external_id, prospect_id, company, title) values ('france_travail', 'o1', $1, 'Siren Co', 'SDR')`, [id]);
    await expect(as(EDITOR, `insert into job_signals (source, external_id, company, title) values ('france_travail', 'o1', 'X', 'Y')`)).rejects.toThrow(/duplicate key/);
    expect((await as(OUTSIDER, `select * from job_signals`)).rows).toHaveLength(0);
    expect((await as(EDITOR, `select * from job_signals`)).rows).toHaveLength(1);
  });
});
