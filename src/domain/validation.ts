// File « À valider par Yannis » : rien ne part sans validation humaine.
import type { Campaign, ContentItem, Drafts, Prospect } from "./types";

export interface PendingItem { kind: "campaign" | "drafts" | "convention" | "content"; id: string; title: string; detail: string }

export function pendingValidation(
  prospects: (Prospect & { drafts?: Drafts | null })[],
  campaigns: Campaign[],
  content: ContentItem[],
): PendingItem[] {
  const out: PendingItem[] = [];
  campaigns.filter((c) => c.status === "Brouillon").forEach((c) => out.push({ kind: "campaign", id: c.id, title: `Campagne « ${c.name} »`, detail: "à valider avant tout envoi" }));
  prospects.filter((p) => p.drafts && !p.drafts.validated && !p.optOut).forEach((p) => out.push({ kind: "drafts", id: p.id, title: `Messages pour ${p.company}`, detail: "brouillons à relire et valider" }));
  prospects.filter((p) => p.partnerStatus === "Convention à valider" && !p.conventionOk).forEach((p) => out.push({ kind: "convention", id: p.id, title: `Convention ${p.company}`, detail: "partenariat à valider" }));
  content.filter((x) => x.status === "À valider").forEach((x) => out.push({ kind: "content", id: x.id, title: `Publication « ${x.title} »`, detail: x.prospectId ? "cite une entreprise : accord requis" : "contenu à valider" }));
  return out;
}

/** Une publication qui cite une entreprise ne peut être validée ou publiée sans son accord écrit. */
export function canApproveContent(c: Pick<ContentItem, "prospectId" | "status">, prospects: Pick<Prospect, "id" | "commsConsent">[]): boolean {
  if (!c.prospectId) return true;
  return !!prospects.find((p) => p.id === c.prospectId)?.commsConsent;
}
