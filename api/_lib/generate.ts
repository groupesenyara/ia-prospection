// Rédaction IA côté serveur. Les consignes sont construites ici, à partir des données en base :
// le navigateur n'envoie jamais de prompt libre (pas de détournement, pas de facture surprise).
import { contentPrompt, outreachPrompt } from "../../src/domain/prompts";
import type { Prospect } from "../../src/domain/types";

export interface GenerateDeps {
  enabled: boolean;
  dailyLimit: number;
  usageToday(): Promise<number>;
  logUsage(kind: string, tokensIn: number, tokensOut: number): Promise<void>;
  getProspect(id: string): Promise<Prospect | null>;
  getSettings(): Promise<{ facts: string[]; signature: string }>;
  complete(prompt: string): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
}

export type GenerateRequest =
  | { kind: "outreach"; prospectId: string }
  | { kind: "content"; title: string; why: string; prospectId?: string | null };

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function generate(req: GenerateRequest, deps: GenerateDeps): Promise<{ text: string }> {
  if (!deps.enabled) throw new HttpError(503, "Rédaction IA désactivée (AI_ENABLED=false). Activation soumise à l’accord de Yannis.");
  if ((await deps.usageToday()) >= deps.dailyLimit) throw new HttpError(429, `Plafond de ${deps.dailyLimit} rédactions par jour atteint`);
  const { facts, signature } = await deps.getSettings();
  let prompt: string;
  if (req.kind === "outreach") {
    const p = await deps.getProspect(req.prospectId);
    if (!p) throw new HttpError(404, "Entreprise introuvable");
    if (p.optOut) throw new HttpError(409, "Entreprise en opposition : rédaction désactivée");
    prompt = outreachPrompt(p, facts, signature);
  } else if (req.kind === "content") {
    const p = req.prospectId ? await deps.getProspect(req.prospectId) : null;
    if (req.prospectId && (!p || !p.commsConsent)) throw new HttpError(409, "Pas d’accord écrit de l’entreprise citée");
    prompt = contentPrompt(String(req.title).slice(0, 200), String(req.why).slice(0, 300), p, facts);
  } else {
    throw new HttpError(400, "Type de rédaction inconnu");
  }
  const r = await deps.complete(prompt);
  await deps.logUsage(req.kind, r.tokensIn, r.tokensOut);
  return { text: r.text };
}
