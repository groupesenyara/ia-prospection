// Opportunity Hunter : lecture des sources, pré-filtre gratuit, analyse par l'IA, score, priorité, contrôle des propositions.
// Fonctions pures : les appels réseau sont dans api/_lib/hunter.ts.
import { checkClaims, type ClaimIssue, type ConfirmedFact } from "./claims.js";
import { factLines, RULES } from "./prompts.js";
import type { UnitFacts } from "./research.js";
import { playbookText, UNIT_IDS, UNITS, type UnitId } from "./units.js";

export type HunterSource = "boamp" | "codeur" | "malt" | "comeup" | "linkedin" | "rss" | "manuel";
export type Priority = "à analyser" | "très élevée" | "élevée" | "à étudier" | "non pertinente";

export interface RawItem {
  source: HunterSource;
  externalId: string;
  url: string;
  title: string;
  description: string;
  buyer: string;
  publishedAt: string; // AAAA-MM-JJ ou ""
  deadline: string;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetText: string;
}

export interface HunterItem extends RawItem {
  id: string;
  contact: string;
  detectedAt: string;
  unit: string | null;
  serviceType: string;
  sector: string;
  score: number | null;
  priority: Priority;
  analysis: Record<string, unknown>;
  reference: string;
  proposal: string;
  proposalIssues: ClaimIssue[];
  validation: "à rédiger" | "à valider" | "validée" | "rejetée";
  sendStatus: "non envoyée" | "envoyée manuellement";
  sentAt: string | null;
  followUpDate: string;
  outcome: "en cours" | "réponse" | "rendez-vous" | "gagné" | "perdu" | "sans suite";
  wonAmount: number | null;
  prospectId: string | null;
  opportunityId: string | null;
}

/** Plateformes étudiées : ce qui est officiellement possible (audit du 2026-11-05). */
export const PLATFORMS: Record<HunterSource, { name: string; integration: string; auto: boolean }> = {
  boamp: { name: "BOAMP (marchés publics)", integration: "API open data officielle de la DILA, gratuite, sans clé. Lecture automatique.", auto: false },
  codeur: { name: "Codeur.com", integration: "Flux RSS des projets par mots-clés (à confirmer en production). Réponse sur la plateforme, à la main.", auto: false },
  malt: { name: "Malt", integration: "Pas d'API publique. Alertes e-mail : coller l'annonce dans l'outil (lecture des e-mails à venir).", auto: false },
  comeup: { name: "ComeUp", integration: "Pas d'API publique. Notifications : coller la demande dans l'outil.", auto: false },
  linkedin: { name: "LinkedIn", integration: "Pas d'API pour les demandes de prestations ; automatisation interdite par ses conditions. Coller la demande dans l'outil.", auto: false },
  rss: { name: "Flux RSS", integration: "Tout flux RSS public ajouté dans les réglages.", auto: false },
  manuel: { name: "Saisie manuelle", integration: "Annonce collée depuis un e-mail ou une page.", auto: false },
};

// --- Lecture des sources ------------------------------------------------------------------------

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&euro;/g, "€")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const stripTags = (s: string) => decode(s).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";
const isoDay = (s: string): string => { const d = new Date(s); return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); };
const num = (s: string) => Number(s.replace(/[\s .]/g, "").replace(",", "."));

/** Budget annoncé en euros : « 500 € à 1 000 € », « Moins de 500 € », « Plus de 10 000 € », « 3 000 € ». */
export function parseBudget(text: string): Pick<RawItem, "budgetMin" | "budgetMax" | "budgetText"> {
  const t = text.replace(/ /g, " ");
  const m = t.match(/budget[^\n:]*:\s*([^\n]{2,80})/i)?.[1] ?? t.match(/((?:moins de|plus de|entre)?\s*\d[\d .]*\s?(?:€|euros?)(?:\s*(?:à|-|et)\s*\d[\d .]*\s?(?:€|euros?))?)/i)?.[1] ?? "";
  const amounts = [...m.matchAll(/(\d[\d .]*\d|\d)\s?(?:k\s?)?(€|euros?)/gi)].map((x) => num(x[1]) * (/k/i.test(x[0]) ? 1000 : 1)).filter((n) => n > 0);
  if (!amounts.length) return { budgetMin: null, budgetMax: null, budgetText: m.trim().slice(0, 80) };
  if (/moins de/i.test(m)) return { budgetMin: 0, budgetMax: amounts[0], budgetText: m.trim() };
  if (/plus de/i.test(m)) return { budgetMin: amounts[0], budgetMax: null, budgetText: m.trim() };
  return { budgetMin: Math.min(...amounts), budgetMax: Math.max(...amounts), budgetText: m.trim().slice(0, 80) };
}

/** Flux RSS 2.0 (Codeur.com ou autre). */
export function parseRss(xml: string, source: HunterSource): RawItem[] {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([block]) => {
    const link = stripTags(tag(block, "link")), title = stripTags(tag(block, "title")), description = stripTags(tag(block, "description")).slice(0, 4000);
    return { source, externalId: stripTags(tag(block, "guid")) || link, url: link, title, description, buyer: "", publishedAt: isoDay(stripTags(tag(block, "pubDate"))), deadline: "", ...parseBudget(`${title}\n${description}`) };
  }).filter((x) => x.title && x.externalId && /^https?:\/\//.test(x.url));
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "");

/** Réponse de l'API open data du BOAMP (Opendatasoft Explore v2.1 : { results: [...] }). */
export function parseBoamp(body: unknown): RawItem[] {
  const list = body && typeof body === "object" && Array.isArray((body as { results?: unknown }).results) ? (body as { results: Record<string, unknown>[] }).results : [];
  return list.map((r) => {
    const id = str(r.idweb) || str(r.id);
    const descr = [str(r.descripteur_libelle), str(r.nature_libelle) || str(r.nature), str(r.type_marche), str(r.code_departement) ? `Département ${str(r.code_departement)}` : ""].filter(Boolean).join(" · ");
    return {
      source: "boamp" as const, externalId: id, url: str(r.url_avis) || (id ? `https://www.boamp.fr/pages/avis/?q=idweb:"${id}"` : ""),
      title: str(r.objet), description: descr, buyer: str(r.nomacheteur), publishedAt: isoDay(str(r.dateparution)), deadline: isoDay(str(r.datelimitereponse)),
      budgetMin: null, budgetMax: null, budgetText: "",
    };
  }).filter((x) => x.externalId && x.title);
}

/** Annonce collée à la main (e-mail Malt, ComeUp, LinkedIn…). L'identifiant est l'URL, ou une empreinte du texte. */
export function manualItem(input: { source: HunterSource; url: string; text: string; buyer?: string }, today: string): RawItem {
  const text = input.text.trim().slice(0, 8000);
  const title = text.split("\n").map((l) => l.trim()).find((l) => l.length > 3)?.slice(0, 160) || "Annonce sans titre";
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  return { source: input.source, externalId: input.url.trim() || `texte-${(h >>> 0).toString(36)}`, url: input.url.trim(), title, description: text, buyer: input.buyer?.trim() || "", publishedAt: today, deadline: "", ...parseBudget(text) };
}

// --- Pré-filtre gratuit (avant tout appel à l'IA) --------------------------------------------------

export const UNIT_KEYWORDS: Record<UnitId, RegExp> = {
  swipsales: /\b(recrut\w*|commerciaux|commercial\w*|sdr|bdr|business develop\w*|chasse de t[êe]tes?|sourcing|ats|logiciel de recrutement)\b/i,
  amandis: /\b(formation\w*|former|formateur|atelier|webinaire|mont[ée]e en comp[ée]tences|acculturation|prospection|n[ée]gociation|marketing digital|cybers[ée]curit[ée]|intelligence artificielle|\bia\b|chatgpt|prompt)\b/i,
  northreef: /\b(site\w*|web\w*|wordpress|shopify|prestashop|woocommerce|e-?commerce|boutique en ligne|application\w*|appli|mobile|logiciel\w*|saas|plateforme|d[ée]velopp\w*|int[ée]gration|api|automatis\w*|agent\w* ia|chatbot|crm|erp|extranet|intranet|portail|espace client|refonte|maintenance|react|node|typescript|n8n|zapier|make\.com)\b/i,
};
const OUT_OF_SCOPE = /\b(stage|stagiaire|alternance|b[ée]n[ée]vole|gratuit(?:ement)?|r[ée]mun[ée]ration en (?:visibilit[ée]|actions)|travaux de (?:voirie|b[âa]timent|peinture)|nettoyage|traduction|r[ée]daction d'articles? seo|comptab\w+)\b/i;

/** Pôles plausibles d'après les mots-clés ; vide = hors périmètre, l'IA n'est pas appelée. */
export function prefilter(item: Pick<RawItem, "title" | "description">): UnitId[] {
  const text = `${item.title}\n${item.description}`;
  if (OUT_OF_SCOPE.test(item.title)) return [];
  return UNIT_IDS.filter((u) => UNIT_KEYWORDS[u].test(text));
}

// --- Analyse par l'IA ---------------------------------------------------------------------------------

export const SAVE_ANALYSIS = "enregistrer_analyse";
const S = { type: "string" } as const;
const I = { type: "integer" } as const;

export const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    pole: { type: "string", enum: ["swipsales", "amandis", "northreef", "aucun"] },
    type_prestation: { type: "string", description: "Ex. : site vitrine, e-commerce, application métier, agent IA, formation IA, recrutement de commerciaux…" },
    besoin: { type: "string", description: "Le besoin exact, en 2 phrases" },
    secteur: S,
    profil_client: { type: "string", description: "Type de client (TPE, PME, collectivité, startup…) et ce qu'on sait de lui" },
    budget_annonce: { type: "string", description: "Budget annoncé tel quel, ou chaîne vide" },
    delai: { type: "string", description: "Délai annoncé ou déduit, ou chaîne vide" },
    complexite: { type: "string", enum: ["faible", "moyenne", "élevée"] },
    technologies: { type: "array", items: S },
    concurrence: { type: "string", description: "Concurrence probable (nombre de réponses si visible, type de prestataires)" },
    alertes: { type: "array", items: S, description: "Signaux d'alerte : brief trop vague, budget irréaliste, fraude possible, hors périmètre, demande de travail gratuit…" },
    notes: {
      type: "object",
      additionalProperties: false,
      description: "Sous-notes de 0 à 10",
      properties: { correspondance: I, budget: I, faisabilite: I, delai: I, rentabilite: I, qualite_brief: I, references: I },
      required: ["correspondance", "budget", "faisabilite", "delai", "rentabilite", "qualite_brief", "references"],
    },
    reference_index: { type: "integer", description: "Numéro de la référence client pertinente dans la liste fournie, ou 0 si aucune ne correspond au type de prestation" },
    budget_propose: { type: "string", description: "Budget cohérent avec le catalogue (« à partir de », fourchette, ou « sur devis après échange » si complexe)" },
    hypotheses: { type: "array", items: S },
    proposition: { type: "string", description: "Réponse personnalisée prête à relire (vide si non pertinente)" },
  },
  required: ["pole", "type_prestation", "besoin", "secteur", "profil_client", "budget_annonce", "delai", "complexite", "technologies", "concurrence", "alertes", "notes", "reference_index", "budget_propose", "hypotheses", "proposition"],
} as const;

/** Références citables (faits confirmés « reference ») de tous les pôles, numérotées à partir de 1. */
export const referenceList = (facts: UnitFacts): { unit: UnitId; text: string }[] =>
  UNIT_IDS.flatMap((u) => (facts[u] || []).filter((f) => f.kind === "reference").map((f) => ({ unit: u, text: f.text })));

export function analysisPrompt(item: RawItem, candidates: UnitId[], facts: UnitFacts): string {
  const refs = referenceList(facts);
  const isTender = item.source === "boamp";
  return `Tu es l'analyste commercial du Groupe Senyara. Analyse cette annonce publiée et décide si l'un de nos pôles doit y répondre.

ANNONCE (${PLATFORMS[item.source].name})
Titre : ${item.title}
${item.buyer ? `Client / acheteur : ${item.buyer}\n` : ""}${item.publishedAt ? `Publiée le : ${item.publishedAt}\n` : ""}${item.deadline ? `Date limite de réponse : ${item.deadline}\n` : ""}${item.budgetText ? `Budget annoncé : ${item.budgetText}\n` : ""}Adresse : ${item.url || "non fournie"}
Texte :
${item.description || "(aucun détail)"}

PÔLES ENVISAGEABLES (d'après les mots-clés) : ${candidates.map((u) => UNITS[u].name).join(", ")}

DOSSIERS DES PÔLES (seuls les faits confirmés peuvent être affirmés)
${candidates.map((u) => `${playbookText(u, factLines(facts[u] || []))}\nSignature : ${UNITS[u].signature}`).join("\n\n")}

RÉFÉRENCES CLIENTS CITABLES (ne cite que celle dont la prestation livrée correspond au besoin ; 0 si aucune)
${refs.length ? refs.map((r, i) => `${i + 1}. [${UNITS[r.unit].name}] ${r.text}`).join("\n") : "Aucune."}

CONSIGNES
- Comprends le besoin exact avant tout. Choisis UN pôle, ou « aucun » si hors périmètre, irréaliste, frauduleux, travail gratuit ou trop vague.
- Note chaque critère de 0 à 10 sans complaisance : un brief vague ou un budget très bas doivent baisser la note.
- Budget proposé : uniquement à partir des tarifs confirmés du pôle (« à partir de », fourchette). Projet complexe ou mal défini : « sur devis après un échange de cadrage », jamais un prix définitif.
${isTender
    ? "- C'est un marché public : la « proposition » est une NOTE DE RÉPONSE interne (intérêt, pièces du dossier à préparer, points à vérifier dans le règlement de consultation, risques), pas un message au client."
    : `- Proposition (si un pôle est retenu) : 150 à 220 mots, en français, vouvoiement. Elle reprend le besoin précis avec les mots du client, montre qu'on a compris le projet, présente le pôle, cite la référence retenue (si elle correspond), explique l'approche en 3 étapes, donne le budget proposé et ses hypothèses, et se termine par une question ou une proposition d'échange de 15 minutes. Jamais générique.`}
${RULES}

Puis appelle l'outil ${SAVE_ANALYSIS} une seule fois.`;
}

// --- Score, priorité et contrôles ---------------------------------------------------------------

const WEIGHTS = { correspondance: 30, budget: 15, faisabilite: 15, delai: 10, rentabilite: 10, qualite_brief: 10, references: 10 } as const;

export function priorityOf(score: number, blocked: boolean): Priority {
  if (blocked) return "non pertinente";
  return score >= 80 ? "très élevée" : score >= 65 ? "élevée" : score >= 45 ? "à étudier" : "non pertinente";
}

const BLOCKING = /fraud|arnaque|gratuit|hors p[ée]rim|irr[ée]aliste|travail non r[ée]mun/i;
const AMOUNT = /\d[\d\s.,]*\s?(€|euros?\b|k€)/i;
const HEDGED = /(à partir de|fourchette|entre|estimation|indicati|à affiner|apr[èe]s (un )?([ée]change|cadrage)|sur devis)/i;

export interface Analysis {
  unit: UnitId | null;
  score: number;
  priority: Priority;
  serviceType: string;
  sector: string;
  reference: string;
  proposal: string;
  proposalIssues: ClaimIssue[];
  validation: HunterItem["validation"];
  analysis: Record<string, unknown>;
}

/** Contrôle la sortie de l'IA : score recalculé, référence vérifiée, proposition passée au garde-fou. */
export function normalizeAnalysis(raw: unknown, _item: RawItem, candidates: UnitId[], facts: UnitFacts): Analysis {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const notes = (r.notes && typeof r.notes === "object" ? r.notes : {}) as Record<string, unknown>;
  const n = (k: keyof typeof WEIGHTS) => Math.max(0, Math.min(10, Math.round(Number(notes[k]) || 0)));
  const score = Math.round(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + (n(k as keyof typeof WEIGHTS) / 10) * w, 0));
  const alertes = Array.isArray(r.alertes) ? r.alertes.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200)) : [];
  const pole = String(r.pole);
  const unit = (candidates as string[]).includes(pole) ? (pole as UnitId) : null; // un pôle non envisagé par le pré-filtre est refusé
  const blocked = !unit || alertes.some((a) => BLOCKING.test(a));
  const priority = priorityOf(score, blocked);

  const refs = referenceList(facts);
  const ri = Math.round(Number(r.reference_index) || 0);
  const ref = ri >= 1 && ri <= refs.length && refs[ri - 1].unit === unit ? refs[ri - 1].text : ""; // référence d'un autre pôle : écartée

  const proposal = priority === "non pertinente" ? "" : (typeof r.proposition === "string" ? r.proposition.replace(/[ \t]+/g, " ").trim().slice(0, 4000) : "");
  const confirmed: ConfirmedFact[] = unit ? facts[unit] || [] : [];
  const issues = proposal ? checkClaims(proposal, confirmed) : [];
  const complex = r.complexite === "élevée";
  if (proposal && complex && AMOUNT.test(proposal) && !HEDGED.test(proposal)) {
    issues.push({ rule: "prix définitif", excerpt: proposal.match(AMOUNT)![0], hint: "Prix ferme sur un projet complexe non qualifié" });
  }
  const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    unit, score, priority,
    serviceType: s(r.type_prestation, 120),
    sector: s(r.secteur, 120),
    reference: ref,
    proposal,
    proposalIssues: issues,
    validation: proposal ? "à valider" : "à rédiger",
    analysis: {
      besoin: s(r.besoin, 600), profilClient: s(r.profil_client), budgetAnnonce: s(r.budget_annonce, 120), delai: s(r.delai, 120),
      complexite: s(r.complexite, 20), technologies: Array.isArray(r.technologies) ? r.technologies.slice(0, 12).map((x) => s(x, 60)) : [],
      concurrence: s(r.concurrence), alertes, notes: Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, n(k as keyof typeof WEIGHTS)])),
      budgetPropose: s(r.budget_propose, 200), hypotheses: Array.isArray(r.hypotheses) ? r.hypotheses.slice(0, 8).map((x) => s(x, 200)) : [],
    },
  };
}

// --- Tableau de bord -----------------------------------------------------------------------------------

const mid = (i: Pick<HunterItem, "budgetMin" | "budgetMax">) => (i.budgetMin != null && i.budgetMax != null ? (i.budgetMin + i.budgetMax) / 2 : i.budgetMax ?? i.budgetMin ?? 0);
const OUTCOME_P: Record<HunterItem["outcome"], number> = { "en cours": 0.1, "réponse": 0.3, "rendez-vous": 0.5, "gagné": 1, "perdu": 0, "sans suite": 0 };

export interface HunterStats {
  fresh: number; highValue: number; toValidate: number; sent: number; replies: number; meetings: number; won: number; wonAmount: number; potential: number;
  bySource: { key: string; items: number; relevant: number; sent: number; replies: number; won: number }[];
  byUnit: { key: string; items: number; relevant: number; sent: number; replies: number; won: number }[];
}

export function hunterStats(items: HunterItem[], since: string): HunterStats {
  const relevant = (i: HunterItem) => i.priority !== "non pertinente" && i.priority !== "à analyser";
  const sent = (i: HunterItem) => i.sendStatus !== "non envoyée";
  const group = (key: (i: HunterItem) => string) => {
    const m = new Map<string, HunterStats["bySource"][number]>();
    for (const i of items) {
      const k = key(i), g = m.get(k) || { key: k, items: 0, relevant: 0, sent: 0, replies: 0, won: 0 };
      g.items++; if (relevant(i)) g.relevant++; if (sent(i)) g.sent++;
      if (["réponse", "rendez-vous", "gagné"].includes(i.outcome)) g.replies++; if (i.outcome === "gagné") g.won++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.items - a.items);
  };
  return {
    fresh: items.filter((i) => i.detectedAt.slice(0, 10) >= since && relevant(i)).length,
    highValue: items.filter((i) => i.priority === "très élevée" || (relevant(i) && mid(i) >= 5000)).length,
    toValidate: items.filter((i) => i.validation === "à valider").length,
    sent: items.filter(sent).length,
    replies: items.filter((i) => ["réponse", "rendez-vous", "gagné"].includes(i.outcome)).length,
    meetings: items.filter((i) => ["rendez-vous", "gagné"].includes(i.outcome)).length,
    won: items.filter((i) => i.outcome === "gagné").length,
    wonAmount: items.reduce((s, i) => s + (i.outcome === "gagné" ? i.wonAmount ?? mid(i) : 0), 0),
    potential: Math.round(items.filter((i) => relevant(i) && sent(i)).reduce((s, i) => s + mid(i) * OUTCOME_P[i.outcome], 0)),
    bySource: group((i) => PLATFORMS[i.source]?.name || i.source),
    byUnit: group((i) => (i.unit ? UNITS[i.unit as UnitId]?.name || i.unit : "Aucun pôle")),
  };
}
