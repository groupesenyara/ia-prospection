import { describe, expect, it, vi } from "vitest";
import type { RawItem } from "../../src/domain/hunter.js";
import { addManual, DEFAULT_CONFIG, readConfig, runHunter, type HunterConfig, type HunterDeps, type HunterStore } from "./hunter.js";

function memory(cfg: Partial<HunterConfig> = {}, analysedToday = 0) {
  const rows: { id: string; item: RawItem; patch: Record<string, unknown> }[] = [];
  const log: string[] = [];
  const store: HunterStore = {
    config: async () => readConfig({ ...DEFAULT_CONFIG, feeds: [], ...cfg }),
    facts: async () => ({ northreef: [{ kind: "tarif", text: "Site vitrine : à partir de 1 000 € HT" }] }),
    insertNew: async (items) => items.filter((i) => !rows.some((r) => r.item.source === i.source && r.item.externalId === i.externalId)).map((i) => { const r = { id: `h${rows.length + 1}`, item: i, patch: { priority: "à analyser" } }; rows.push(r); return { id: r.id, item: i }; }),
    pending: async (n) => rows.filter((r) => r.patch.priority === "à analyser").slice(0, n),
    analysedToday: async () => analysedToday,
    update: async (id, patch) => { Object.assign(rows.find((r) => r.id === id)!.patch, patch); },
    log: async (action) => { log.push(action); },
    logUsage: async () => {},
  };
  return { store, rows, log };
}
const boampBody = { results: [
  { idweb: "26-1", objet: "Refonte du site internet de la commune", nomacheteur: "Commune A", dateparution: "2026-11-04" },
  { idweb: "26-2", objet: "Travaux de voirie", nomacheteur: "Commune B", dateparution: "2026-11-04" },
  { idweb: "26-3", objet: "Formation des agents à l'intelligence artificielle", nomacheteur: "Département C", dateparution: "2026-11-04" },
] };
const answer = (pole: string) => ({ raw: { pole, type_prestation: "Refonte", besoin: "b", secteur: "Public", profil_client: "Collectivité", budget_annonce: "", delai: "", complexite: "moyenne", technologies: [], concurrence: "", alertes: [], notes: { correspondance: 8, budget: 6, faisabilite: 8, delai: 7, rentabilite: 6, qualite_brief: 7, references: 6 }, reference_index: 0, budget_propose: "sur devis", hypotheses: [], proposition: "Note de réponse : dossier à préparer." }, tokensIn: 3000, tokensOut: 600, searches: 0, fetches: 0, stop: "tool_use", usd: 0.0006 });

const deps = (m: ReturnType<typeof memory>, o: Partial<HunterDeps> = {}): HunterDeps => ({
  store: m.store, today: "2026-11-05", fetchText: async () => "", fetchJson: async () => boampBody,
  analyse: vi.fn(async (prompt: string) => answer(/intelligence artificielle/.test(prompt) ? "amandis" : "northreef")), ...o,
});

describe("Opportunity Hunter", () => {
  it("mode assisté : BOAMP lu, hors périmètre écarté sans IA, analyses et propositions, sans doublon au passage suivant", async () => {
    const m = memory();
    const d = deps(m);
    const r = await runHunter(d);
    expect(r).toMatchObject({ collected: 3, relevant: 2, added: 2, analysed: 2, drafted: 2, errors: [] });
    expect(m.rows.map((x) => x.patch.unit)).toEqual(["northreef", "amandis"]);
    expect(m.rows[0].patch).toMatchObject({ priority: "élevée", validation: "à valider" });
    expect(d.analyse).toHaveBeenCalledTimes(2);
    expect(await runHunter(d)).toMatchObject({ added: 0, analysed: 0 });
  });
  it("mode surveillance : enregistre sans appeler l'IA", async () => {
    const m = memory({ mode: "surveillance" });
    const d = deps(m);
    expect(await runHunter(d)).toMatchObject({ added: 2, analysed: 0 });
    expect(d.analyse).not.toHaveBeenCalled();
  });
  it("arrêt d'urgence : aucun passage, aucune lecture", async () => {
    const m = memory({ paused: true });
    const fetchJson = vi.fn();
    expect(await runHunter(deps(m, { fetchJson }))).toMatchObject({ paused: true, added: 0 });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(m.log).toEqual(["arrêt d'urgence"]);
    await expect(addManual(deps(m), { source: "malt", url: "", text: "Recherche développeur pour une application de réservation en ligne" })).rejects.toThrow(/Arrêt d'urgence/);
  });
  it("limite quotidienne d'analyses ; une source en panne n'arrête pas les autres", async () => {
    const m = memory({ dailyLimit: 1, feeds: [{ source: "codeur", url: "https://www.codeur.com/projects?format=rss" }] });
    const r = await runHunter(deps(m, { fetchText: async () => { throw new Error("HTTP 403"); } }));
    expect(r.errors).toEqual(["codeur (https://www.codeur.com/projects?format=rss) : HTTP 403"]);
    expect(r).toMatchObject({ added: 2, analysed: 1 });
    expect(m.rows.filter((x) => x.patch.priority === "à analyser")).toHaveLength(1);
  });
  it("« automatique » est refusé : la configuration retombe en mode assisté", () => {
    expect(readConfig({ mode: "automatique" }).mode).toBe("assiste");
  });
  it("annonce collée (Malt, ComeUp, LinkedIn) : enregistrée, analysée, doublon refusé", async () => {
    const m = memory();
    const d = deps(m);
    const text = "Nous cherchons une agence pour créer le site vitrine de notre boulangerie à Douai. Budget : 1 500 €";
    expect(await addManual(d, { source: "malt", url: "https://www.malt.fr/x", text })).toMatchObject({ duplicate: false });
    expect(m.rows[0].patch.unit).toBe("northreef");
    expect(await addManual(d, { source: "malt", url: "https://www.malt.fr/x", text })).toEqual({ id: null, duplicate: true });
  });
});
