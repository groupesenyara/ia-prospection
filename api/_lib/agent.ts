// Agents web : Claude cherche et lit des pages publiques (outils exécutés par Anthropic),
// puis rend son résultat en appelant un outil d'enregistrement dont le format est imposé (strict).
import type { BetaMessage, BetaMessageParam, BetaTool, BetaToolUnion, BetaToolUseBlock, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type MessagesApi = { create(body: MessageCreateParamsNonStreaming): Promise<BetaMessage> };

export interface AgentResult {
  raw: unknown | null;
  tokensIn: number;
  tokensOut: number;
  searches: number;
  fetches: number;
  stop: string;
}

export interface AgentTask {
  prompt: string;
  saveTool: string;
  saveSchema: unknown;
  saveDescription: string;
  searches: number; // recherches web maximum (0,01 $ chacune)
  fetches: number; // pages lues maximum (0 = pas de lecture de page)
  effort?: "low" | "medium" | "high";
}

/** Réseaux sociaux : jamais ouverts par l'agent (conditions d'utilisation). Leurs adresses peuvent être citées depuis les résultats de recherche. */
export const NO_FETCH = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com"];

/** Modèles qui ont les outils web à filtrage dynamique et le repli serveur en cas de refus. */
const ADVANCED = /^claude-(opus|sonnet|fable)-/;

export function tools(model: string, t: Pick<AgentTask, "saveTool" | "saveSchema" | "saveDescription" | "searches" | "fetches">): BetaToolUnion[] {
  const adv = ADVANCED.test(model);
  const list: BetaToolUnion[] = [
    adv
      ? { type: "web_search_20260209", name: "web_search", max_uses: t.searches, user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" } }
      : { type: "web_search_20250305", name: "web_search", max_uses: t.searches, user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" } },
  ];
  if (t.fetches > 0) {
    list.push(adv
      ? { type: "web_fetch_20260209", name: "web_fetch", max_uses: t.fetches, blocked_domains: NO_FETCH, max_content_tokens: 5000 }
      : { type: "web_fetch_20250910", name: "web_fetch", max_uses: t.fetches, blocked_domains: NO_FETCH, max_content_tokens: 5000 });
  }
  list.push({ name: t.saveTool, description: t.saveDescription, strict: true, input_schema: t.saveSchema as BetaTool.InputSchema });
  return list;
}

export async function runAgent(api: MessagesApi, model: string, task: AgentTask, maxTurns = 6): Promise<AgentResult> {
  const messages: BetaMessageParam[] = [{ role: "user", content: task.prompt }];
  const out: AgentResult = { raw: null, tokensIn: 0, tokensOut: 0, searches: 0, fetches: 0, stop: "" };
  const fallback = ADVANCED.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
  let nudged = false;
  for (let turn = 0; turn < maxTurns; turn++) {
    const msg = await api.create({
      model,
      max_tokens: 8000,
      ...fallback,
      output_config: { effort: task.effort ?? "low" },
      tools: tools(model, task),
      tool_choice: { type: "auto" },
      messages,
    });
    out.tokensIn += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    out.tokensOut += msg.usage.output_tokens;
    out.searches += msg.usage.server_tool_use?.web_search_requests ?? 0;
    out.fetches += msg.usage.server_tool_use?.web_fetch_requests ?? 0;
    out.stop = msg.stop_reason ?? "";

    const save = msg.content.find((b): b is BetaToolUseBlock => b.type === "tool_use" && b.name === task.saveTool);
    if (save) { out.raw = save.input; return out; }
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return out;

    messages.push({ role: "assistant", content: msg.content });
    if (msg.stop_reason === "pause_turn") continue; // le serveur reprend la recherche là où il s'est arrêté
    if (nudged) return out;
    nudged = true;
    messages.push({ role: "user", content: `Termine maintenant : appelle l'outil ${task.saveTool} avec ce que tu as trouvé (listes vides pour ce qui manque).` });
  }
  return out;
}

/** Coût estimé en dollars (tarifs publics) : jetons + 0,01 $ par recherche web. La lecture de pages ne coûte que ses jetons. */
export function estimateUsd(model: string, r: Pick<AgentResult, "tokensIn" | "tokensOut" | "searches">): number {
  const [pin, pout] = /haiku-5-5/.test(model) ? [0.1, 0.5] : /sonnet/.test(model) ? [2, 10] : /opus-5-5/.test(model) ? [4, 20] : [5, 25];
  return Math.round(((r.tokensIn * pin + r.tokensOut * pout) / 1e6 + r.searches * 0.01) * 1000) / 1000;
}
