// Branchement réel de l'agent : variables d'environnement Vercel, Supabase, sources, Claude.
// Choix par défaut pour le coût : Claude Haiku 5.5 (0,10 $ / 0,50 $ par million de jetons), peu de recherches,
// pas de lecture de page pour la détection. France Travail, gratuit, est utilisé s'il est configuré.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { offersFromWeb, offersSchema, SAVE_OFFERS, webDiscoveryPrompt } from "../../src/domain/discovery.js";
import { SAVE_TOOL, saveToolSchema } from "../../src/domain/research.js";
import { estimateUsd, runAgent } from "./agent.js";
import type { Deps } from "./prospecting.js";
import { supabaseStore } from "./prospecting.js";
import { findFirms, franceTravailToken, registryPage, salesOffers } from "./sources.js";

export const researchLimit = () => Math.max(0, Number(process.env.RESEARCH_DAILY_LIMIT || 30));
export const aiReady = () => process.env.AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;
export const researchModel = () => process.env.RESEARCH_MODEL || "claude-haiku-5-5";

export function liveDeps(db: SupabaseClient, deadline?: number): Deps {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const ftId = process.env.FRANCE_TRAVAIL_CLIENT_ID, ftSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
  const api = aiReady() ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).beta.messages : null;
  const model = researchModel();
  return {
    store: supabaseStore(db, today),
    today,
    offers: ftId && ftSecret
      ? async () => ({ origin: "france_travail" as const, offers: await salesOffers(await franceTravailToken(ftId, ftSecret), { days: 7, pages: 4 }) })
      : api
        ? async ({ want, exclude }) => {
          const r = await runAgent(api, model, { prompt: webDiscoveryPrompt(today, want, exclude), saveTool: SAVE_OFFERS, saveSchema: offersSchema, saveDescription: "Enregistre les annonces trouvées. À appeler une seule fois.", searches: 8, fetches: 0, effort: "low" });
          return { origin: "web" as const, offers: offersFromWeb(r.raw, today), usage: r, usd: estimateUsd(model, r) };
        }
        : null,
    firms: (name) => findFirms(name),
    registry: (q) => registryPage(q),
    research: api
      ? async (prompt) => {
        const r = await runAgent(api, model, { prompt, saveTool: SAVE_TOOL, saveSchema: saveToolSchema, saveDescription: "Enregistre la fiche de prospection finale. À appeler une seule fois, quand les recherches sont terminées.", searches: 3, fetches: 3, effort: "medium", maxTokens: 16000 });
        return { ...r, usd: estimateUsd(model, r) };
      }
      : null,
    dailyLimit: researchLimit(),
    deadline,
  };
}
