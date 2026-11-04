import { describe, expect, it, vi } from "vitest";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Firm, JobOffer } from "../../src/domain/discovery.js";
import type { Prospect } from "../../src/domain/types.js";
import { fromRow } from "../../src/lib/mapping.js";
import { runResearchAgent, tools, type MessagesApi } from "./agent.js";
import { discover, enrichPending, type Deps, type Store } from "./prospecting.js";
import { findFirms, salesOffers } from "./sources.js";

const msg = (stop: string, content: unknown[], usage: Record<string, unknown> = {}): BetaMessage =>
  ({ stop_reason: stop, content, usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 }, ...usage } }) as unknown as BetaMessage;

describe("agent de recherche", () => {
  it("reprend après pause_turn puis récupère la fiche enregistrée", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(msg("pause_turn", [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "acme" } }]))
      .mockResolvedValueOnce(msg("tool_use", [{ type: "tool_use", id: "t1", name: "enregistrer_fiche", input: { resume: "ok" } }]));
    const r = await runResearchAgent({ create } as MessagesApi, "claude-sonnet-5-5", "prompt");
    expect(r).toMatchObject({ raw: { resume: "ok" }, tokensIn: 200, tokensOut: 20, searches: 2, fetches: 4 });
    const body = create.mock.calls[1][0];
    expect(body.messages.at(-1).role).toBe("assistant"); // reprise : pas de message « continue » ajouté
    expect(body.fallbacks).toBe("default");
  });
  it("relance une fois si l'agent répond sans enregistrer, puis abandonne proprement", async () => {
    const create = vi.fn().mockResolvedValue(msg("end_turn", [{ type: "text", text: "Voici ce que j'ai trouvé" }]));
    const r = await runResearchAgent({ create } as MessagesApi, "m", "prompt");
    expect(r.raw).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("n'ouvre jamais les réseaux sociaux", () => {
    const fetchTool = tools().find((t) => "name" in t && t.name === "web_fetch") as { blocked_domains: string[] };
    expect(fetchTool.blocked_domains).toContain("linkedin.com");
  });
});

describe("sources publiques", () => {
  it("France Travail : pages de 150 offres tant que la réponse est partielle (206)", async () => {
    const page = (n: number) => ({ resultats: Array.from({ length: n }, (_, i) => ({ id: `o${n}-${i}`, intitule: "Commercial", entreprise: { nom: `E${i}` }, dateCreation: "2026-11-01" })) });
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page(150)), { status: 206 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(3)), { status: 200 }));
    const offers = await salesOffers("tok", { pages: 4 }, f as unknown as typeof fetch);
    expect(offers).toHaveLength(153);
    expect(String(f.mock.calls[1][0])).toContain("range=150-299");
    expect(String(f.mock.calls[0][0])).toContain("codeROME=D1401%2CD1402");
  });
  it("registre : réessaie après une limitation de débit", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ siren: "123456789", nom_complet: "ACME" }] }), { status: 200 }));
    expect((await findFirms("Acme", f as unknown as typeof fetch))[0].siren).toBe("123456789");
  });
});

function memoryStore(rows: Record<string, unknown>[] = []) {
  const signals: unknown[] = [];
  const usage: string[] = [];
  const store: Store = {
    known: async () => rows.map((r) => ({ id: r.id as string, company: r.company as string, website: (r.website as string) || "", siren: (r.siren as string) || null })),
    insertProspect: async (p) => { const id = `p${rows.length + 1}`; rows.push({ ...p, id }); return id; },
    insertSignals: async (id, offers) => { signals.push(...offers.map((o) => ({ id, ext: o.id }))); },
    researchUsedToday: async () => usage.length,
    pending: async (n) => rows.filter((r) => r.researchStatus === "à rechercher" && !r.optOut).slice(0, n) as unknown as Prospect[],
    get: async (id) => (rows.find((r) => r.id === id) as unknown as Prospect) || null,
    update: async (id, patch) => { const r = rows.find((x) => x.id === id)!; Object.assign(r, fromRow(patch)); },
    logUsage: async (kind) => { usage.push(kind); },
    product: async () => ({ facts: [], signature: "Yannis" }),
  };
  return { store, rows, signals, usage };
}
const offer = (id: string, company: string): JobOffer => ({ id, title: "Commercial terrain", company, companyUrl: "", city: "Lyon", postalCode: "69003", rome: "D1402", contract: "CDI", publishedAt: "2026-11-03", url: `https://ft/${id}`, excerpt: "", headcountLabel: "" });
const firm = (siren: string, name: string, headcountCode = "12"): Firm => ({ siren, name, naf: "62.01Z", nafLabel: "", headcountCode, category: "PME", city: "Lyon", postalCode: "69003", created: "", active: true, officers: [] });

describe("orchestration", () => {
  it("crée les fiches des PME cibles, une seule fois par SIREN, avec leurs offres", async () => {
    const m = memoryStore([{ id: "p0", company: "Déjà Là", siren: "000000000" }]);
    const registry: Record<string, Firm[]> = { "Acme": [firm("123456789", "ACME")], "Gros Groupe": [firm("222222222", "GROS GROUPE", "41")], "DLA Commerce": [firm("000000000", "DLA COMMERCE")], "Inconnue": [] };
    const d: Deps = { store: m.store, today: "2026-11-04", offers: async () => [offer("1", "Acme"), offer("2", "Acme"), offer("3", "Gros Groupe"), offer("4", "DLA Commerce"), offer("5", "Inconnue")], firms: async (n) => registry[n] || [], research: null, dailyLimit: 10 };
    const r = await discover(d, 10);
    expect(r.added).toEqual(["Acme"]);
    expect(r.skipped).toEqual({ "hors cible (taille)": 1, "déjà en base": 1, "introuvable au registre": 1 });
    expect(m.signals).toHaveLength(2);
    expect(m.rows.find((x) => x.siren === "123456789")).toMatchObject({ researchStatus: "à rechercher", origin: "france_travail" });
  });

  it("sans compte France Travail, la détection est sautée avec un message clair", async () => {
    const r = await discover({ store: memoryStore().store, today: "x", offers: null, firms: async () => [], research: null, dailyLimit: 10 }, 10);
    expect(r.note).toMatch(/FRANCE_TRAVAIL_CLIENT_ID/);
  });

  it("recherche dans la limite du plafond quotidien et trace l'échec", async () => {
    const m = memoryStore([
      { id: "a", company: "A", researchStatus: "à rechercher", optOut: false, crit: {} },
      { id: "b", company: "B", researchStatus: "à rechercher", optOut: false, crit: {} },
      { id: "c", company: "C", researchStatus: "à rechercher", optOut: false, crit: {} },
    ]);
    const research = vi.fn()
      .mockResolvedValueOnce({ raw: { resume: "Société A", contacts: [{ type: "email", valeur: "contact@a.fr", titulaire: "standard", source_url: "https://a.fr/contact" }] }, tokensIn: 1000, tokensOut: 100, searches: 3, fetches: 2, stop: "tool_use" })
      .mockResolvedValueOnce({ raw: null, tokensIn: 500, tokensOut: 50, searches: 1, fetches: 0, stop: "refusal" });
    const r = await enrichPending({ store: m.store, today: "2026-11-04", offers: null, firms: async () => [], research, dailyLimit: 2 }, 1);
    expect(r).toMatchObject({ done: ["A"], failed: ["B"], tokensIn: 1500, searches: 4 });
    expect(m.rows[0]).toMatchObject({ researchStatus: "fait", email: "contact@a.fr", contactSource: "https://a.fr/contact" });
    expect((m.rows[0].research as { cost: unknown }).cost).toEqual({ tokensIn: 1000, tokensOut: 100, searches: 3, fetches: 2 });
    expect(m.rows[1]).toMatchObject({ researchStatus: "échec" });
    expect(m.rows[2].researchStatus).toBe("à rechercher"); // plafond de 2 atteint
    expect(m.usage).toEqual(["recherche", "recherche"]);
  });
});
