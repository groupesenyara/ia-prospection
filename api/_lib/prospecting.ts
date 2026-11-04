// Orchestration de l'agent de prospection : détection (France Travail + registre), puis recherche web par l'IA.
// N'envoie rien : les fiches et les brouillons attendent la validation de Yannis.
import type { SupabaseClient } from "@supabase/supabase-js";
import { departementsOf, groupByCompany, inTargetSize, matchFirm, pickCandidates, prospectFromDiscovery, prospectFromFirm, REGISTRY_TARGETS, rotate, type Firm, type JobOffer } from "../../src/domain/discovery.js";
import { normalizeResearch, researchPrompt, type OpportunityDraft, type UnitFacts } from "../../src/domain/research.js";
import type { UnitId } from "../../src/domain/units.js";
import type { Prospect } from "../../src/domain/types.js";
import { prospectFromRow, toRow } from "../../src/lib/mapping.js";
import type { AgentResult } from "./agent.js";

type Known = Pick<Prospect, "id" | "company" | "website"> & { siren?: string | null };

export interface Store {
  known(): Promise<Known[]>;
  insertProspect(p: Partial<Prospect>): Promise<string>;
  insertSignals(prospectId: string, offers: JobOffer[], source: string): Promise<void>;
  researchUsedToday(): Promise<number>;
  pending(limit: number): Promise<Prospect[]>;
  get(id: string): Promise<Prospect | null>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  logUsage(kind: string, tokensIn: number, tokensOut: number): Promise<void>;
  facts(): Promise<UnitFacts>;
  /** Crée ou met à jour l'opportunité ouverte de chaque pôle pertinent (sans toucher au pipeline ni à l'activation). */
  upsertOpportunities(prospectId: string, opps: OpportunityDraft[]): Promise<void>;
}

export interface Deps {
  store: Store;
  today: string;
  /** Offres commerciales récentes : France Travail (gratuit) si configuré, sinon recherche web par l'IA. */
  offers: ((ctx: { want: number; exclude: string[] }) => Promise<OfferBatch>) | null;
  firms(name: string): Promise<Firm[]>;
  /** Registre officiel : une page d'entreprises d'un département pour une activité et des tailles. */
  registry?: (q: { departement: string; naf: string; tranches: string[]; page: number }) => Promise<{ firms: Firm[]; totalPages: number }>;
  research: ((prompt: string) => Promise<AgentResult & { usd?: number }>) | null; // null : IA désactivée
  dailyLimit: number;
  deadline?: number; // horodatage au-delà duquel on ne lance plus de recherche
}

export interface OfferBatch { offers: JobOffer[]; origin: "france_travail" | "web"; usage?: AgentResult; usd?: number }
export interface DiscoveryReport { origin?: string; offers: number; companies: number; added: string[]; skipped: Record<string, number>; usd?: number; note?: string }

export async function discover(d: Deps, want: number): Promise<DiscoveryReport> {
  const report: DiscoveryReport = { offers: 0, companies: 0, added: [], skipped: {} };
  if (!d.offers) return { ...report, note: "Détection désactivée (ni France Travail, ni IA)" };
  if (want <= 0) return { ...report, note: "Quota du jour atteint" };
  const skip = (why: string) => { report.skipped[why] = (report.skipped[why] || 0) + 1; };
  const known = await d.store.known();
  const batch = await d.offers({ want, exclude: known.map((k) => k.company) });
  if (batch.usage) await d.store.logUsage("detection", batch.usage.tokensIn, batch.usage.tokensOut);
  const offers = batch.offers;
  const groups = groupByCompany(offers);
  Object.assign(report, { origin: batch.origin, usd: batch.usd, offers: offers.length, companies: groups.length });
  const sirens = new Set(known.map((k) => k.siren).filter(Boolean));
  for (const g of pickCandidates(groups, known, want * 4)) {
    if (report.added.length >= want) break;
    let firm: Firm | null;
    try { firm = matchFirm(g, await d.firms(g.company)); } catch { skip("registre indisponible"); continue; }
    if (!firm) { skip("introuvable au registre"); continue; }
    if (sirens.has(firm.siren)) { skip("déjà en base"); continue; }
    if (!inTargetSize(firm)) { skip("hors cible (taille)"); continue; }
    const id = await d.store.insertProspect(prospectFromDiscovery(g, firm, d.today, batch.origin));
    await d.store.insertSignals(id, g.offers, batch.origin);
    sirens.add(firm.siren);
    report.added.push(g.company);
  }
  return report;
}

export interface RegistryReport { unit: string; departements: string[]; added: string[]; scanned: number; note?: string }

/**
 * Détection gratuite par le registre, pour UN pôle : entreprises actives des départements du jour,
 * dans les activités et tailles visées par le pôle, absentes du CRM (SIREN). Chaque fiche reçoit l'opportunité du pôle.
 */
export async function discoverRegistry(d: Deps, unit: keyof typeof REGISTRY_TARGETS, want: number, imposed: string[] = []): Promise<RegistryReport> {
  const target = REGISTRY_TARGETS[unit];
  const departements = departementsOf(d.today, imposed);
  const report: RegistryReport = { unit, departements, added: [], scanned: 0 };
  if (!d.registry) return { ...report, note: "Registre non branché" };
  if (want <= 0) return report;
  const sirens = new Set((await d.store.known()).map((k) => k.siren).filter(Boolean));
  outer: for (const naf of rotate(target.naf, d.today)) {
    for (const departement of departements) {
      for (let page = 1; page <= 3; page++) {
        let res: { firms: Firm[]; totalPages: number };
        try { res = await d.registry({ departement, naf, tranches: target.tranches, page }); } catch (e) { report.note = (e as Error).message; break; }
        report.scanned += res.firms.length;
        for (const firm of res.firms) {
          if (!firm.active || !/^\d{9}$/.test(firm.siren) || !firm.name || sirens.has(firm.siren)) continue;
          sirens.add(firm.siren);
          const id = await d.store.insertProspect(prospectFromFirm(firm, unit, d.today));
          if (unit !== "swipsales") await d.store.upsertOpportunities(id, [{ unit, score: 0, offer: "", reason: `Cible ${target.label}`, signal: "", signalSource: "", primary: true }]);
          report.added.push(firm.name);
          if (report.added.length >= want) break outer;
        }
        if (page >= res.totalPages) break;
      }
    }
  }
  return report;
}

export interface EnrichReport { done: string[]; failed: string[]; left: number; note?: string; tokensIn: number; tokensOut: number; searches: number; usd: number }

export async function enrichOne(d: Deps, p: Prospect): Promise<boolean> {
  if (!d.research) throw new Error("IA désactivée");
  if (p.optOut) return false;
  await d.store.update(p.id, { research_status: "en cours" });
  try {
    const facts = await d.store.facts();
    const r = await d.research(researchPrompt(p, facts));
    await d.store.logUsage("recherche", r.tokensIn, r.tokensOut);
    if (!r.raw) {
      await d.store.update(p.id, { research_status: "échec", research: { ...(p.research || {}), at: d.today, gaps: `Recherche interrompue (${r.stop || "sans fiche"})` } });
      return false;
    }
    const { patch, opportunities } = normalizeResearch(r.raw, p, d.today, facts);
    patch.research = { ...patch.research, cost: { tokensIn: r.tokensIn, tokensOut: r.tokensOut, searches: r.searches, fetches: r.fetches, usd: r.usd } };
    await d.store.update(p.id, toRow(patch as Record<string, unknown>, ["id"]));
    await d.store.upsertOpportunities(p.id, opportunities);
    return true;
  } catch (e) {
    await d.store.update(p.id, { research_status: "échec", research: { ...(p.research || {}), at: d.today, gaps: `Erreur : ${(e as Error).message}`.slice(0, 300) } });
    throw e;
  }
}

export async function enrichPending(d: Deps, concurrency = 5): Promise<EnrichReport> {
  const report: EnrichReport = { done: [], failed: [], left: 0, tokensIn: 0, tokensOut: 0, searches: 0, usd: 0 };
  if (!d.research) return { ...report, note: "IA désactivée (AI_ENABLED / ANTHROPIC_API_KEY)" };
  const quota = Math.max(0, d.dailyLimit - (await d.store.researchUsedToday()));
  if (!quota) return { ...report, note: `Plafond de ${d.dailyLimit} recherches par jour atteint` };
  const queue = await d.store.pending(quota);
  const research = d.research;
  const wrapped: Deps = { ...d, research: async (prompt) => { const r = await research(prompt); report.tokensIn += r.tokensIn; report.tokensOut += r.tokensOut; report.searches += r.searches; report.usd = Math.round((report.usd + (r.usd ?? 0)) * 1000) / 1000; return r; } };
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      if (d.deadline && Date.now() > d.deadline) { report.left++; continue; }
      try { (await enrichOne(wrapped, p)) ? report.done.push(p.company) : report.failed.push(p.company); } catch (e) { console.error("[prospect]", p.company, e); report.failed.push(p.company); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return report;
}

// --- Supabase -------------------------------------------------------------------------------------

export function supabaseStore(db: SupabaseClient, today: string): Store {
  const must = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    async known() { return must(await db.from("prospects").select("id,company,website,siren")) as Known[]; },
    async insertProspect(p) { return (must(await db.from("prospects").insert(toRow(p as Record<string, unknown>, ["id"])).select("id").single()) as { id: string }).id; },
    async insertSignals(prospectId, offers, source) {
      if (!offers.length) return;
      must(await db.from("job_signals").upsert(offers.map((o) => ({ source, external_id: o.id, prospect_id: prospectId, company: o.company, title: o.title, rome: o.rome, contract: o.contract, city: o.city, published_at: o.publishedAt || null, url: o.url, excerpt: o.excerpt })), { onConflict: "source,external_id", ignoreDuplicates: true }));
    },
    async researchUsedToday() {
      const { count, error } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("day", today).eq("kind", "recherche");
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async pending(limit) {
      // « à rechercher », plus les recherches restées « en cours » plus de 15 minutes (passage interrompu par la limite de durée)
      const stale = new Date(Date.now() - 15 * 60_000).toISOString();
      return (must(await db.from("prospects").select("*").eq("opt_out", false)
        .or(`research_status.eq.à rechercher,and(research_status.eq.en cours,updated_at.lt.${stale})`)
        .order("signal_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(limit)) as Record<string, unknown>[]).map(prospectFromRow);
    },
    async get(id) { const r = must(await db.from("prospects").select("*").eq("id", id).maybeSingle()); return r ? prospectFromRow(r as Record<string, unknown>) : null; },
    async update(id, patch) { must(await db.from("prospects").update(patch).eq("id", id)); },
    async logUsage(kind, tokensIn, tokensOut) { must(await db.from("ai_usage").insert({ day: today, kind, tokens_in: tokensIn, tokens_out: tokensOut })); },
    async facts() {
      const rows = must(await db.from("unit_facts").select("unit,kind,text").eq("status", "Confirmé")) as { unit: UnitId; kind: never; text: string }[];
      const out: UnitFacts = {};
      for (const f of rows) (out[f.unit] ||= []).push({ kind: f.kind, text: f.text });
      return out;
    },
    async upsertOpportunities(prospectId, opps) {
      for (const o of opps) {
        const fields = { score: o.score, offer: o.offer, reason: o.reason };
        const signal = o.signal && o.signalSource ? { signal: o.signal, signal_source: o.signalSource } : {};
        const { data: existing } = await db.from("opportunities").select("id").eq("prospect_id", prospectId).eq("unit", o.unit).in("status", ["ouverte", "en attente"]).maybeSingle();
        // Swipe Sales : le pipeline et le signal restent synchronisés depuis la fiche (prospects.stage)
        if (existing) must(await db.from("opportunities").update(o.unit === "swipsales" ? fields : { ...fields, ...signal }).eq("id", existing.id));
        else must(await db.from("opportunities").insert({ prospect_id: prospectId, unit: o.unit, stage: "Entreprise identifiée", ...fields, ...signal }));
      }
    },
  };
}
