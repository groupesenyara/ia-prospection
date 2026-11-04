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
  await db.exec(readFileSync(new URL("./migrations/20261104134714_prospecting.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("./migrations/20261104150439_multi_units.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("./migrations/20261104150623_pin_search_path.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("./migrations/20261104155755_opportunity_hunter.sql", import.meta.url), "utf8"));
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

  it("multi-pôles : chaque fiche Swipe Sales a son opportunité, synchronisée avec le pipeline existant", async () => {
    const id = (await as(EDITOR, `insert into prospects (company, source) values ('Multi Co', 'https://x') returning id`)).rows[0].id;
    let o = (await as(EDITOR, `select unit, stage, status, active from opportunities where prospect_id = $1`, [id])).rows;
    expect(o).toEqual([{ unit: "swipsales", stage: "Entreprise identifiée", status: "ouverte", active: false }]);
    await as(EDITOR, `update prospects set stage = 'Contact effectué', next_action = 'Relance 1' where id = $1`, [id]);
    o = (await as(EDITOR, `select stage, active, next_action from opportunities where prospect_id = $1`, [id])).rows;
    expect(o).toEqual([{ stage: "Contact effectué", active: true, next_action: "Relance 1" }]);
    // l'application actuelle journalise sans connaître les pôles : rattaché à Swipe Sales
    await as(EDITOR, `insert into interactions (prospect_id, type) values ($1, 'contact_email')`, [id]);
    expect((await as(EDITOR, `select unit from interactions where prospect_id = $1`, [id])).rows[0].unit).toBe("swipsales");
  });

  it("multi-pôles : une seule opportunité ouverte par pôle, un seul pôle sollicite à la fois", async () => {
    const id = (await as(EDITOR, `select id from prospects where company = 'Multi Co'`)).rows[0].id;
    await as(EDITOR, `insert into opportunities (prospect_id, unit, reason) values ($1, 'amandis', 'Recrute 3 commerciaux juniors : besoin de formation')`, [id]);
    await expect(as(EDITOR, `insert into opportunities (prospect_id, unit) values ($1, 'amandis')`, [id])).rejects.toThrow(/opportunities_one_open_per_unit/);
    await expect(as(EDITOR, `update opportunities set active = true where prospect_id = $1 and unit = 'amandis'`, [id])).rejects.toThrow(/déjà cette entreprise/);
    await expect(as(EDITOR, `insert into interactions (prospect_id, type, unit) values ($1, 'contact_email', 'amandis')`, [id])).rejects.toThrow(/déjà sollicitée par Swipe Sales/);
    // Swipe Sales mis en attente -> Amandis peut prendre le relais
    await as(EDITOR, `update opportunities set active = false, status = 'en attente' where prospect_id = $1 and unit = 'swipsales'`, [id]);
    await as(EDITOR, `update opportunities set active = true where prospect_id = $1 and unit = 'amandis'`, [id]);
    await as(EDITOR, `insert into interactions (prospect_id, type, unit) values ($1, 'contact_email', 'amandis')`, [id]);
    // et le pipeline Swipe Sales ne réactive pas Swipe Sales par-dessus Amandis
    await as(EDITOR, `update prospects set next_action = 'Relance 2' where id = $1`, [id]);
    expect((await as(EDITOR, `select active from opportunities where prospect_id = $1 and unit = 'swipsales'`, [id])).rows[0].active).toBe(false);
  });

  it("multi-pôles : opposition, faits confirmés par l'owner seul, contacts sourcés", async () => {
    const id = (await as(EDITOR, `insert into prospects (company, source, opt_out) values ('Stop Multi', 'x', true) returning id`)).rows[0].id;
    await expect(as(EDITOR, `insert into opportunities (prospect_id, unit, active) values ($1, 'northreef', true)`, [id])).rejects.toThrow(/ne plus être contactée/);
    await as(EDITOR, `insert into unit_facts (unit, kind, text) values ('amandis', 'certification', 'Certifié Qualiopi')`);
    await expect(as(EDITOR, `update unit_facts set status = 'Confirmé' where text = 'Certifié Qualiopi'`)).rejects.toThrow(/owner/);
    await as(OWNER, `update unit_facts set status = 'Confirmé' where text = 'Certifié Qualiopi'`);
    expect((await as(OWNER, `select confirmed_by from unit_facts where text = 'Certifié Qualiopi'`)).rows[0].confirmed_by).toBe(OWNER);
    await expect(as(EDITOR, `insert into contacts (prospect_id, name, email) values ($1, 'X', 'x@y.fr')`, [id])).rejects.toThrow(/contact_source/);
    expect((await as(OUTSIDER, `select * from opportunities`)).rows).toHaveLength(0);
    expect((await as(EDITOR, `select id from business_units order by sort`)).rows.map((r: { id: string }) => r.id)).toEqual(["swipsales", "amandis", "northreef"]);
    await expect(as(EDITOR, `update business_units set name = 'X' where id = 'amandis' returning id`)).resolves.toMatchObject({ rows: [] });
  });

  it("Opportunity Hunter : anti-doublon, validation par l'owner, pas d'envoi sans validation ni avec une alerte", async () => {
    const id = (await as(EDITOR, `insert into hunter_items (source, external_id, title, proposal) values ('boamp', '26-12345', 'Refonte du site de la mairie', 'Proposition') returning id`)).rows[0].id;
    await expect(as(EDITOR, `insert into hunter_items (source, external_id, title) values ('boamp', '26-12345', 'Doublon')`)).rejects.toThrow(/duplicate key/);
    await expect(as(EDITOR, `update hunter_items set send_status = 'envoyée manuellement' where id = $1`, [id])).rejects.toThrow(/envoi_apres_validation/);
    await expect(as(EDITOR, `update hunter_items set validation = 'validée' where id = $1`, [id])).rejects.toThrow(/owner/);
    await expect(as(OWNER, `update hunter_items set validation = 'validée', proposal_issues = '[{"rule":"prix"}]' where id = $1`, [id])).rejects.toThrow(/proposition_sans_alerte/);
    await as(OWNER, `update hunter_items set validation = 'validée' where id = $1`, [id]);
    await as(EDITOR, `update hunter_items set proposal = 'Modifiée' where id = $1`, [id]); // modifiée après validation : à revalider
    expect((await as(OWNER, `select validation from hunter_items where id = $1`, [id])).rows[0].validation).toBe("à valider");
    await as(OWNER, `update hunter_items set validation = 'validée' where id = $1`, [id]);
    await as(EDITOR, `update hunter_items set send_status = 'envoyée manuellement' where id = $1`, [id]);
    expect((await as(OWNER, `select validated_by, sent_at is not null as sent from hunter_items where id = $1`, [id])).rows[0]).toEqual({ validated_by: OWNER, sent: true });
    await expect(as(EDITOR, `update hunter_items set proposal = 'Après envoi' where id = $1`, [id])).rejects.toThrow(/déjà envoyée/);
    await expect(as(EDITOR, `update hunter_items set send_status = 'envoyée auto' where id = $1`, [id])).rejects.toThrow(/send_status_check/);
    expect((await as(OUTSIDER, `select * from hunter_items`)).rows).toHaveLength(0);
  });
});
