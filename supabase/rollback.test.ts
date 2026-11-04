// Le retour arrière de chaque migration réversible doit fonctionner, sans perdre les fiches existantes.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("retour arrière multi-pôles", () => {
  it("annule la migration en conservant les fiches, puis peut la réappliquer", async () => {
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
    for (const m of ["20261102125807_init", "20261102125942_hardening", "20261104134714_prospecting"]) await db.exec(sql(`./migrations/${m}.sql`));
    await db.exec(`insert into public.prospects (company, source, stage) values ('Gardée', 'x', 'Contact effectué')`);
    await db.exec(sql("./migrations/20261104150439_multi_units.sql"));
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.opportunities`)).rows[0].n).toBe(1);
    await db.exec(sql("./rollback/20261104150439_multi_units_down.sql"));
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.prospects`)).rows[0].n).toBe(1);
    expect((await db.query(`select to_regclass('public.opportunities') r`)).rows[0]).toEqual({ r: null });
    await db.exec(`insert into public.interactions (prospect_id, type) select id, 'contact_email' from public.prospects`);
    await db.exec(sql("./migrations/20261104150439_multi_units.sql"));
    expect((await db.query<{ stage: string; active: boolean }>(`select stage, active from public.opportunities`)).rows).toEqual([{ stage: "Contact effectué", active: true }]);
  });

  it("Opportunity Hunter : retour arrière sans toucher aux fiches", async () => {
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
    for (const m of ["20261102125807_init", "20261102125942_hardening", "20261104134714_prospecting", "20261104150439_multi_units", "20261104150623_pin_search_path", "20261105120000_opportunity_hunter"]) await db.exec(sql(`./migrations/${m}.sql`));
    await db.exec(`insert into public.prospects (company, source) values ('Gardée', 'x'); insert into public.hunter_items (source, external_id, title) values ('boamp', '1', 'Avis')`);
    await db.exec(sql("./rollback/20261105120000_opportunity_hunter_down.sql"));
    expect((await db.query(`select to_regclass('public.hunter_items') r`)).rows[0]).toEqual({ r: null });
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.prospects`)).rows[0].n).toBe(1);
    await db.exec(sql("./migrations/20261105120000_opportunity_hunter.sql"));
  });
});
