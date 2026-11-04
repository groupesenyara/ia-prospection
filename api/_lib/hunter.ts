// Opportunity Hunter côté serveur : collecte des sources autorisées, anti-doublon, analyse et rédaction (mode assisté),
// journal, limite quotidienne et arrêt d'urgence. N'ENVOIE RIEN : la réponse se fait sur la plateforme, après validation.
import type { SupabaseClient } from "@supabase/supabase-js";
import { analysisPrompt, manualItem, normalizeAnalysis, parseBoamp, parseRss, prefilter, type HunterSource, type RawItem } from "../../src/domain/hunter.js";
import type { UnitFacts } from "../../src/domain/research.js";
import type { UnitId } from "../../src/domain/units.js";
import type { AgentResult } from "./agent.js";

export interface HunterConfig {
  mode: "surveillance" | "assiste"; // « automatique » : refusé tant qu'aucune plateforme ne l'autorise
  paused: boolean; // arrêt d'urgence
  dailyLimit: number; // analyses IA par jour
  boamp: boolean;
  feeds: { source: HunterSource; url: string }[];
}

const codeur = (k: string) => ({ source: "codeur" as const, url: `https://www.codeur.com/projects?format=rss&order=recent&keywords=${encodeURIComponent(k)}` });
export const DEFAULT_CONFIG: HunterConfig = {
  mode: "assiste",
  paused: false,
  dailyLimit: 30,
  boamp: true,
  feeds: ["site internet", "e-commerce", "application", "logiciel sur mesure", "automatisation", "agent IA", "formation"].map(codeur),
};

export function readConfig(v: unknown): HunterConfig {
  const c = (v && typeof v === "object" ? v : {}) as Partial<HunterConfig>;
  return {
    mode: c.mode === "surveillance" ? "surveillance" : "assiste",
    paused: c.paused === true,
    dailyLimit: Math.max(0, Math.min(200, Number(c.dailyLimit ?? DEFAULT_CONFIG.dailyLimit) || 0)),
    boamp: c.boamp !== false,
    feeds: Array.isArray(c.feeds) ? c.feeds.filter((f) => f && /^https?:\/\//.test(String(f.url))).slice(0, 30) : DEFAULT_CONFIG.feeds,
  };
}

export interface HunterStore {
  config(): Promise<HunterConfig>;
  facts(): Promise<UnitFacts>;
  /** Insère les nouvelles annonces ; renvoie les identifiants créés (les doublons sont ignorés). */
  insertNew(items: (RawItem & { unit: UnitId | null })[]): Promise<{ id: string; item: RawItem }[]>;
  pending(limit: number): Promise<{ id: string; item: RawItem }[]>;
  analysedToday(): Promise<number>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  log(action: string, detail: string, itemId?: string): Promise<void>;
  logUsage(tokensIn: number, tokensOut: number, unit: UnitId | null): Promise<void>;
}

export interface HunterDeps {
  store: HunterStore;
  today: string;
  fetchText(url: string): Promise<string>;
  fetchJson(url: string): Promise<unknown>;
  analyse: ((prompt: string) => Promise<AgentResult & { usd?: number }>) | null;
  budgetMs?: number;
}

export interface HunterReport { at: string; paused?: boolean; collected: number; relevant: number; added: number; analysed: number; drafted: number; errors: string[]; usd: number; note?: string }

/** Marchés publics publiés depuis `days` jours (BOAMP, API open data de la DILA). */
export async function collectBoamp(d: HunterDeps, days = 2, pages = 5): Promise<RawItem[]> {
  const since = new Date(Date.parse(d.today + "T00:00:00Z") - days * 864e5).toISOString().slice(0, 10);
  const out: RawItem[] = [];
  for (let p = 0; p < pages; p++) {
    const q = new URLSearchParams({ where: `dateparution >= date'${since}'`, order_by: "dateparution desc", limit: "100", offset: String(p * 100) });
    const batch = parseBoamp(await d.fetchJson(`https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records?${q}`));
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export async function analyseOne(d: HunterDeps, id: string, item: RawItem, facts: UnitFacts): Promise<{ drafted: boolean; usd: number }> {
  const candidates = prefilter(item);
  if (!d.analyse) throw new Error("IA désactivée");
  if (!candidates.length) { await d.store.update(id, { priority: "non pertinente", analysis: { filtre: "hors périmètre (mots-clés)" } }); return { drafted: false, usd: 0 }; }
  const r = await d.analyse(analysisPrompt(item, candidates, facts));
  const a = normalizeAnalysis(r.raw, item, candidates, facts);
  await d.store.logUsage(r.tokensIn, r.tokensOut, a.unit);
  await d.store.update(id, {
    unit: a.unit, score: r.raw ? a.score : null, priority: r.raw ? a.priority : "à analyser", service_type: a.serviceType, sector: a.sector,
    reference: a.reference, proposal: a.proposal, proposal_issues: a.proposalIssues, validation: a.validation,
    analysis: r.raw ? a.analysis : { erreur: `Analyse interrompue (${r.stop || "sans résultat"})` },
  });
  await d.store.log(r.raw ? "analyse" : "analyse en échec", r.raw ? `${a.priority} · ${a.score}/100${a.proposal ? " · proposition rédigée" : ""}${a.proposalIssues.length ? ` · ${a.proposalIssues.length} alerte(s)` : ""}` : r.stop, id);
  return { drafted: !!a.proposal, usd: r.usd ?? 0 };
}

export async function runHunter(d: HunterDeps): Promise<HunterReport> {
  const cfg = await d.store.config();
  const report: HunterReport = { at: new Date().toISOString(), collected: 0, relevant: 0, added: 0, analysed: 0, drafted: 0, errors: [], usd: 0 };
  if (cfg.paused) { await d.store.log("arrêt d'urgence", "veille suspendue : aucun passage"); return { ...report, paused: true, note: "Arrêt d'urgence actif" }; }

  // 1. Collecte (sources officielles ou flux publics uniquement)
  const raw: RawItem[] = [];
  if (cfg.boamp) {
    try { raw.push(...(await collectBoamp(d))); } catch (e) { report.errors.push(`BOAMP : ${(e as Error).message}`); }
  }
  for (const f of cfg.feeds) {
    try { raw.push(...parseRss(await d.fetchText(f.url), f.source)); } catch (e) { report.errors.push(`${f.source} (${f.url.slice(0, 80)}) : ${(e as Error).message}`); }
  }
  report.collected = raw.length;

  // 2. Pré-filtre gratuit + anti-doublon (même annonce sur plusieurs flux)
  const seen = new Set<string>();
  const relevant = raw.filter((i) => { const k = `${i.source}|${i.externalId}`; if (seen.has(k) || !prefilter(i).length) return false; seen.add(k); return true; });
  report.relevant = relevant.length;
  const created = await d.store.insertNew(relevant.map((i) => ({ ...i, unit: prefilter(i).length === 1 ? prefilter(i)[0] : null })));
  report.added = created.length;
  if (created.length) await d.store.log("détection", `${created.length} nouvelle(s) annonce(s) sur ${raw.length} lue(s)`);

  // 3. Mode assisté : analyse et rédaction, dans la limite quotidienne
  if (cfg.mode !== "assiste") return { ...report, note: "Mode surveillance : annonces enregistrées sans analyse" };
  if (!d.analyse) return { ...report, note: "IA désactivée (AI_ENABLED / ANTHROPIC_API_KEY)" };
  const quota = Math.max(0, cfg.dailyLimit - (await d.store.analysedToday()));
  if (!quota) return { ...report, note: `Limite de ${cfg.dailyLimit} analyses par jour atteinte` };
  const facts = await d.store.facts();
  const queue = await d.store.pending(quota);
  const deadline = Date.now() + (d.budgetMs ?? 230_000); // limite Vercel : 5 minutes par passage
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (Date.now() > deadline) continue; // reste « à analyser » pour le prochain passage
      try {
        const r = await analyseOne(d, next.id, next.item, facts);
        report.analysed++; if (r.drafted) report.drafted++; report.usd = Math.round((report.usd + r.usd) * 1000) / 1000;
      } catch (e) { report.errors.push(`Analyse « ${next.item.title.slice(0, 60)} » : ${(e as Error).message}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));
  return report;
}

export async function addManual(d: HunterDeps, input: { source: HunterSource; url: string; text: string; buyer?: string }): Promise<{ id: string | null; duplicate: boolean }> {
  const cfg = await d.store.config();
  if (cfg.paused) throw new Error("Arrêt d'urgence actif");
  const item = manualItem(input, d.today);
  const created = await d.store.insertNew([{ ...item, unit: null }]);
  if (!created.length) return { id: null, duplicate: true };
  await d.store.log("ajout manuel", `${input.source} · ${item.title.slice(0, 80)}`, created[0].id);
  if (cfg.mode === "assiste" && d.analyse && (await d.store.analysedToday()) < cfg.dailyLimit) await analyseOne(d, created[0].id, item, await d.store.facts());
  return { id: created[0].id, duplicate: false };
}

// --- Supabase -----------------------------------------------------------------------------------

const toItem = (r: Record<string, unknown>): RawItem => ({
  source: r.source as HunterSource, externalId: String(r.external_id), url: String(r.url || ""), title: String(r.title || ""), description: String(r.description || ""),
  buyer: String(r.buyer || ""), publishedAt: String(r.published_at || ""), deadline: String(r.deadline || ""),
  budgetMin: r.budget_min == null ? null : Number(r.budget_min), budgetMax: r.budget_max == null ? null : Number(r.budget_max), budgetText: String(r.budget_text || ""),
});

export function supabaseHunterStore(db: SupabaseClient, today: string): HunterStore {
  const must = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    async config() { const { data } = await db.from("settings").select("value").eq("key", "hunter").maybeSingle(); return readConfig(data?.value); },
    async facts() {
      const rows = must(await db.from("unit_facts").select("unit,kind,text").eq("status", "Confirmé")) as { unit: UnitId; kind: never; text: string }[];
      const out: UnitFacts = {};
      for (const f of rows) (out[f.unit] ||= []).push({ kind: f.kind, text: f.text });
      return out;
    },
    async insertNew(items) {
      if (!items.length) return [];
      const rows = items.map((i) => ({
        source: i.source, external_id: i.externalId.slice(0, 500), url: i.url, title: i.title.slice(0, 300), description: i.description, buyer: i.buyer,
        published_at: i.publishedAt || null, deadline: i.deadline || null, budget_min: i.budgetMin, budget_max: i.budgetMax, budget_text: i.budgetText, unit: i.unit,
      }));
      const data = must(await db.from("hunter_items").upsert(rows, { onConflict: "source,external_id", ignoreDuplicates: true }).select("*")) as Record<string, unknown>[];
      return (data || []).map((r) => ({ id: String(r.id), item: toItem(r) }));
    },
    async pending(limit) {
      const data = must(await db.from("hunter_items").select("*").eq("priority", "à analyser").order("detected_at", { ascending: false }).limit(limit)) as Record<string, unknown>[];
      return data.map((r) => ({ id: String(r.id), item: toItem(r) }));
    },
    async analysedToday() {
      const { count, error } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("day", today).eq("kind", "hunter");
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async update(id, patch) { must(await db.from("hunter_items").update(patch).eq("id", id)); },
    async log(action, detail, itemId) { must(await db.from("hunter_log").insert({ action, detail: detail.slice(0, 500), item_id: itemId ?? null })); },
    async logUsage(tokensIn, tokensOut, unit) { must(await db.from("ai_usage").insert({ day: today, kind: "hunter", tokens_in: tokensIn, tokens_out: tokensOut, unit })); },
  };
}
