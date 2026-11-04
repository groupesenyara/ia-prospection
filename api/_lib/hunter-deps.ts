// Branchement réel de l'Opportunity Hunter : Supabase, sources publiques, Claude (sans outil web : on analyse le texte de l'annonce).
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analysisSchema, SAVE_ANALYSIS } from "../../src/domain/hunter.js";
import { estimateUsd, runAgent } from "./agent.js";
import { aiReady, researchModel } from "./deps.js";
import { supabaseHunterStore, type HunterDeps } from "./hunter.js";

const UA = "SenyaraCommercial/1.0 (veille d'appels d'offres)";

export function hunterDeps(db: SupabaseClient): HunterDeps {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const api = aiReady() ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).beta.messages : null;
  const model = researchModel();
  const get = async (url: string, accept: string) => {
    const res = await fetch(url, { headers: { accept, "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  };
  return {
    store: supabaseHunterStore(db, today),
    today,
    fetchText: async (url) => (await get(url, "application/rss+xml, application/xml, text/xml")).text(),
    fetchJson: async (url) => (await get(url, "application/json")).json(),
    analyse: api
      ? async (prompt) => {
        // Pas de recherche web (0 recherche, 0 page) : l'analyse porte sur le texte de l'annonce, donc très peu coûteuse.
        const r = await runAgent(api, model, { prompt, saveTool: SAVE_ANALYSIS, saveSchema: analysisSchema, saveDescription: "Enregistre l'analyse de l'annonce et la proposition. À appeler une seule fois.", searches: 0, fetches: 0, effort: "medium" });
        return { ...r, usd: estimateUsd(model, r) };
      }
      : null,
  };
}
