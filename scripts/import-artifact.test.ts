// Vérifie que l'import d'un export réel passe les règles de la base (PGlite + migration).
import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { transform, uuidFrom } from "./import-artifact";

describe("import du prototype", () => {
  it("UUID stables", () => { expect(uuidFrom("a")).toBe(uuidFrom("a")); expect(uuidFrom("a")).toMatch(/^[0-9a-f-]{36}$/); });
  it.skipIf(!existsSync("exports/prospects"))("l'export réel respecte toutes les contraintes", async () => {
    const d = transform("exports");
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
    await db.exec(readFileSync("supabase/migrations/20261102125807_init.sql", "utf8"));
    const ins = async (table: string, rows: Record<string, unknown>[]) => {
      for (const r of rows) {
        const cols = Object.keys(r);
        const vals = cols.map((c) => (typeof r[c] === "object" && r[c] !== null && !Array.isArray(r[c]) ? JSON.stringify(r[c]) : r[c]));
        const cast = cols.map((c, i) => (["steps", "crit", "drafts", "value"].includes(c) ? `$${i + 1}::jsonb` : `$${i + 1}`));
        await db.query(`insert into ${table} (${cols.join(",")}) values (${cast.join(",")})`, cols.map((c, i) => (["steps"].includes(c) ? JSON.stringify(r[c]) : vals[i])));
      }
    };
    await ins("campaigns", d.campaigns);
    await ins("prospects", d.prospects);
    await ins("interactions", d.interactions);
    await ins("settings", d.settings);
    await ins("feedback", d.feedback);
    const n = await db.query<{ n: number }>("select count(*)::int as n from prospects");
    expect(n.rows[0].n).toBe(d.prospects.length);
  });
});
