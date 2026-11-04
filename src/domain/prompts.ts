// Consignes envoyées à Claude. Partagées entre le front (aperçu) et la fonction serveur (appel réel).
import type { Prospect } from "./types.js";

export const RULES = `RÈGLES ABSOLUES
- Utilise uniquement les informations fournies. N'invente aucun chiffre, client, témoignage, résultat, statistique, offre d'emploi, coordonnée ni fonctionnalité.
- N'affirme jamais que SwipSales permet de recruter plus vite, moins cher ou mieux.
- Les éléments marqués HYPOTHÈSE ou ESTIMATION se formulent comme des questions, jamais comme des faits.
- Ne cite un prix que s'il figure dans les faits produit confirmés.
- Vouvoiement, ton direct et humain, phrases courtes, pas de jargon, pas d'emoji.`;

export function prospectFacts(p: Prospect): string {
  const lines: string[] = [];
  const add = (l: string, v: string, kind: string) => { if (v) lines.push(`- ${l} [${kind}] : ${v}`); };
  add("Entreprise", p.company, "FAIT");
  add("Site", p.website, "FAIT");
  add("Secteur", p.sector, "FAIT");
  add("Taille estimée", p.size !== "Inconnue" ? p.size : "", "ESTIMATION");
  add("Postes commerciaux recherchés", p.roles, `FAIT, source : ${p.source}`);
  add("Décideur", p.decisionName && p.decisionVerified ? `${p.decisionName}, ${p.decisionTitle}` : "", "FAIT");
  add("Signal d’achat", p.signal, p.signalSource ? `FAIT, daté du ${p.signalDate || "?"}` : "HYPOTHÈSE");
  add("Besoin supposé", p.need, "HYPOTHÈSE");
  const r = p.research;
  if (r?.summary) lines.push(`- Présentation [FAIT, recherche du ${r.at || "?"}] : ${r.summary}`);
  for (const f of [...(r?.signals || []), ...(r?.facts || [])].slice(0, 8)) lines.push(`- ${f.text} [FAIT, source : ${f.url}${f.date ? `, ${f.date}` : ""}]`);
  for (const o of (r?.offers || []).slice(0, 5)) lines.push(`- Offre publiée le ${o.date} : ${o.title} [FAIT, source : ${o.url}]`);
  for (const a of (r?.angles || []).slice(0, 4)) lines.push(`- Angle d’approche possible : ${a.angle} (appui : ${a.basis}) [PISTE]`);
  return lines.join("\n") || "- (peu d'informations)";
}

export function outreachPrompt(p: Prospect, facts: string[], signature: string): string {
  return `Tu prépares des brouillons de prospection B2B en français pour SwipSales, plateforme de recrutement réservée aux profils commerciaux. Un humain relira et enverra lui-même.

${RULES}
- E-mail : 120 mots maximum, une seule question, un appel à l'action simple ; personnalise-le avec un fait sourcé ; il cite la source de l'adresse en une phrase discrète et se termine par une phrase qui permet de refuser les relances. Signature : ${signature || "[Prénom Nom]"}.
- LinkedIn : 300 caractères maximum.

FAITS PRODUIT CONFIRMÉS
${facts.length ? facts.map((f) => "- " + f).join("\n") : "- Aucun fait confirmé : décris seulement SwipSales comme une plateforme dédiée au recrutement commercial."}

PROSPECT
${prospectFacts(p)}

Réponds uniquement avec un objet JSON :
{"accroche":"","email_objet":"","email":"","linkedin":"","script_appel":"","questions_decouverte":[""],"objections":[{"objection":"","reponse":""}],"proposition_demo":"","plan_relance":[{"jour":"J+3","canal":"","message":""}]}`;
}

export function contentPrompt(title: string, why: string, company: Pick<Prospect, "company" | "roles" | "sector"> | null, facts: string[]): string {
  return `Rédige en français un post LinkedIn pour la page SwipSales (plateforme de recrutement réservée aux profils commerciaux), 90 mots maximum, ton direct et humain, sans emoji.
Sujet : ${title}. Contexte : ${why}.
${company ? `Entreprise concernée : ${company.company}${company.roles ? ", postes : " + company.roles : ""}. N'invente rien sur elle : pas de citation, pas de chiffre, pas de résultat.` : ""}
Faits produit utilisables : ${facts.join(" ; ") || "plateforme réservée au recrutement commercial, matching par swipe, échange après un match"}.
Règles : aucun prix, aucun chiffre sur SwipSales, aucune promesse de résultat, aucun témoignage inventé. Si une citation serait utile, écris [CITATION À DEMANDER].
Réponds uniquement par le texte du post.`;
}
