// Propositions de contenus déclenchées par l'activité commerciale (jamais publiées sans validation).
import type { ContentItem, Prospect } from "./types";

export interface Suggestion { kind: string; prospectId: string | null; title: string; why: string }

export function contentSuggestions(prospects: Prospect[], content: ContentItem[], objections: [string, number][]): Suggestion[] {
  const done = new Set(content.map((c) => `${c.prospectId}|${c.kind}`));
  const out: Suggestion[] = [];
  for (const p of prospects) {
    if (!p.commsConsent) continue; // pas d'accord écrit : aucune suggestion qui cite l'entreprise
    if (p.segment === "B" && p.trialStart && !done.has(`${p.id}|welcome`)) out.push({ kind: "welcome", prospectId: p.id, title: `Bienvenue à ${p.company}, Founding Recruiter`, why: "Essai démarré et accord écrit reçu" });
    if (p.segment === "A" && p.partnerStatus === "Actif" && !done.has(`${p.id}|partner`)) out.push({ kind: "partner", prospectId: p.id, title: `Annonce du partenariat avec ${p.company}`, why: "Partenariat actif et accord écrit reçu" });
    if (p.offerPublished && !done.has(`${p.id}|offer`)) out.push({ kind: "offer", prospectId: p.id, title: `Offre publiée par ${p.company}`, why: "Offre réelle en ligne et accord écrit reçu" });
  }
  objections.filter(([, n]) => n >= 2).slice(0, 3).forEach(([o, n]) => {
    if (!done.has(`|obj:${o}`)) out.push({ kind: `obj:${o}`, prospectId: null, title: `Contenu qui répond à « ${o} »`, why: `Objection entendue ${n} fois en prospection` });
  });
  return out;
}
