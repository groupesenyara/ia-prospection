// Agent de recherche : Claude cherche et lit des pages publiques (outils web exécutés par Anthropic),
// puis rend sa fiche en appelant l'outil `enregistrer_fiche`, dont le format est imposé (strict).
import type { BetaMessage, BetaMessageParam, BetaTool, BetaToolUnion, BetaToolUseBlock, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { SAVE_TOOL, saveToolSchema } from "../../src/domain/research.js";

export type MessagesApi = { create(body: MessageCreateParamsNonStreaming): Promise<BetaMessage> };

export interface AgentResult {
  raw: unknown | null;
  tokensIn: number;
  tokensOut: number;
  searches: number;
  fetches: number;
  stop: string;
}

/** Réseaux sociaux : jamais ouverts par l'agent (conditions d'utilisation). Leurs adresses peuvent être citées depuis les résultats de recherche. */
export const NO_FETCH = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com"];

export function tools(): BetaToolUnion[] {
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: 6, user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" } },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8, blocked_domains: NO_FETCH, max_content_tokens: 12000 },
    {
      name: SAVE_TOOL,
      description: "Enregistre la fiche de prospection finale. À appeler une seule fois, quand les recherches sont terminées.",
      strict: true,
      input_schema: saveToolSchema as unknown as BetaTool.InputSchema,
    },
  ];
}

export async function runResearchAgent(api: MessagesApi, model: string, prompt: string, maxTurns = 8): Promise<AgentResult> {
  const messages: BetaMessageParam[] = [{ role: "user", content: prompt }];
  const out: AgentResult = { raw: null, tokensIn: 0, tokensOut: 0, searches: 0, fetches: 0, stop: "" };
  let nudged = false;
  for (let turn = 0; turn < maxTurns; turn++) {
    const msg = await api.create({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      tools: tools(),
      tool_choice: { type: "auto" },
      messages,
    });
    out.tokensIn += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    out.tokensOut += msg.usage.output_tokens;
    out.searches += msg.usage.server_tool_use?.web_search_requests ?? 0;
    out.fetches += msg.usage.server_tool_use?.web_fetch_requests ?? 0;
    out.stop = msg.stop_reason ?? "";

    const save = msg.content.find((b): b is BetaToolUseBlock => b.type === "tool_use" && b.name === SAVE_TOOL);
    if (save) { out.raw = save.input; return out; }
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return out;

    messages.push({ role: "assistant", content: msg.content });
    if (msg.stop_reason === "pause_turn") continue; // le serveur reprend la recherche là où il s'est arrêté
    if (nudged) return out;
    nudged = true;
    messages.push({ role: "user", content: `Termine maintenant : appelle l'outil ${SAVE_TOOL} avec ce que tu as trouvé (listes vides pour ce qui manque).` });
  }
  return out;
}
