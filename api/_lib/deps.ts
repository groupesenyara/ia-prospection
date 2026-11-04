// Branchement réel de l'agent : variables d'environnement Vercel, Supabase, France Travail, registre, Claude.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runResearchAgent } from "./agent.js";
import type { Deps } from "./prospecting.js";
import { supabaseStore } from "./prospecting.js";
import { findFirms, franceTravailToken, salesOffers } from "./sources.js";

export const researchLimit = () => Math.max(0, Number(process.env.RESEARCH_DAILY_LIMIT || 10));
export const aiReady = () => process.env.AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;

export function liveDeps(db: SupabaseClient, deadline?: number): Deps {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const ftId = process.env.FRANCE_TRAVAIL_CLIENT_ID, ftSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
  const client = aiReady() ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  return {
    store: supabaseStore(db, today),
    today,
    offers: ftId && ftSecret ? async () => salesOffers(await franceTravailToken(ftId, ftSecret), { days: 7, pages: 4 }) : null,
    firms: (name) => findFirms(name),
    research: client ? (prompt) => runResearchAgent(client.beta.messages, model, prompt) : null,
    dailyLimit: researchLimit(),
    deadline,
  };
}
