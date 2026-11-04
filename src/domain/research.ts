// Recherche web d'une entreprise par l'agent : consignes, format de sortie et contrôle de ce qui est conservé.
// Principe : on ne garde que des informations publiques, publiées par l'entreprise ou une source professionnelle,
// avec l'adresse de la page où elles ont été lues. Rien n'est deviné (pas d'e-mail reconstitué prénom.nom@).
import { CRITERIA } from "./scoring.js";
import { RULES } from "./prompts.js";
import { domainOf } from "./dedup.js";
import type { Angle, Criterion, DecisionMaker, Prospect, PublicContact, ResearchDossier, SourcedFact } from "./types.js";

export const SAVE_TOOL = "enregistrer_fiche";

const S = { type: "string" } as const;
const sourced = (props: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties: { ...props, source_url: { type: "string", description: "Adresse exacte de la page publique où l'information a été lue" } },
  required: [...Object.keys(props), "source_url"],
});
const level = { type: "object", additionalProperties: false, properties: { niveau: { type: "integer", description: "0 à 3" }, base: { type: "string", enum: ["fait", "hypothese"] } }, required: ["niveau", "base"] };

/** Outil que l'agent appelle une seule fois, à la fin, pour rendre sa fiche. */
export const saveToolSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    site_web: { type: "string", description: "Site officiel de l'entreprise, ou chaîne vide" },
    resume: { type: "string", description: "3 phrases maximum : activité, clients, taille, actualité" },
    secteur: S,
    decideurs: { type: "array", items: sourced({ nom: S, fonction: S }), description: "Personnes qui décident des recrutements commerciaux (dirigeant, directeur commercial, DRH), nommées sur une source publique" },
    contacts: {
      type: "array",
      description: "Coordonnées PROFESSIONNELLES PUBLIÉES telles quelles. Jamais d'adresse reconstituée.",
      items: sourced({ type: { type: "string", enum: ["email", "telephone", "linkedin", "formulaire"] }, valeur: S, titulaire: { type: "string", description: "Nom et fonction de la personne, ou « standard », « service RH », « recrutement »" } }),
    },
    faits: { type: "array", items: sourced({ fait: S, date: { type: "string", description: "AAAA-MM-JJ ou chaîne vide" } }) },
    signaux: { type: "array", description: "Signaux d'achat récents : recrutements commerciaux, levée de fonds, ouverture d'agence, nouveau produit, croissance", items: sourced({ signal: S, date: S }) },
    angles: { type: "array", description: "2 à 4 angles d'approche personnalisés", items: { type: "object", additionalProperties: false, properties: { angle: S, appui: { type: "string", description: "Le fait sourcé sur lequel l'angle s'appuie" } }, required: ["angle", "appui"] } },
    besoin_suppose: S,
    qualification: { type: "object", additionalProperties: false, properties: { volume: level, pertinence: level, fit: level, access: level, recurrence: level }, required: ["volume", "pertinence", "fit", "access", "recurrence"] },
    approche: {
      type: "object",
      additionalProperties: false,
      properties: { accroche: S, email_objet: S, email: S, script_appel: S, linkedin: S },
      required: ["accroche", "email_objet", "email", "script_appel", "linkedin"],
    },
    limites: { type: "string", description: "Ce qui n'a pas été trouvé ou reste incertain" },
  },
  required: ["site_web", "resume", "secteur", "decideurs", "contacts", "faits", "signaux", "angles", "besoin_suppose", "qualification", "approche", "limites"],
} as const;

export function researchPrompt(p: Prospect, productFacts: string[], signature: string): string {
  const r = p.research || {};
  const known = [
    `Entreprise : ${p.company}`,
    p.siren ? `SIREN : ${p.siren} (${r.registry?.url || "registre public"})` : "",
    p.city ? `Ville : ${p.city}` : "",
    p.website ? `Site connu : ${p.website}` : "",
    p.sector ? `Activité (registre) : ${p.sector}` : "",
    p.headcount ? `Effectif (registre) : ${p.headcount}` : "",
    r.registry?.officers?.length ? `Dirigeants (registre) : ${r.registry.officers.map((o) => `${o.name}, ${o.role}`).join(" ; ")}` : "",
    r.offers?.length ? `Offres commerciales publiées :\n${r.offers.map((o) => `  - ${o.date} · ${o.title} · ${o.city} · ${o.url}`).join("\n")}` : p.signal ? `Signal : ${p.signal} (${p.signalSource})` : "",
  ].filter(Boolean).join("\n");
  return `Tu es l'agent de prospection de SwipSales, plateforme de recrutement réservée aux profils commerciaux (SDR, BDR, commerciaux terrain et sédentaires, account managers). Tu prépares la fiche d'une entreprise qui recrute des commerciaux, pour qu'un humain la contacte de façon personnalisée.

CE QUE L'ON SAIT DÉJÀ
${known}

TA MISSION
1. Trouve le site officiel, puis lis ses pages Contact, Mentions légales, Équipe / À propos, Carrières / Recrutement et Actualités.
2. Relève les coordonnées professionnelles PUBLIÉES : standard téléphonique, e-mail générique (contact@, rh@, recrutement@, jobs@), e-mail ou téléphone nominatif seulement s'il est publié tel quel par l'entreprise ou par la personne elle-même dans un cadre professionnel, page LinkedIn de l'entreprise ou profil public du décideur, formulaire de contact.
3. Identifie qui décide des recrutements commerciaux (dirigeant, directeur commercial, DRH) et sa fonction exacte.
4. Relève les faits utiles pour personnaliser l'approche : activité, clients ou marchés, croissance, levées de fonds, ouvertures, nouveaux produits, presse, nombre et nature des postes commerciaux ouverts.
5. Propose 2 à 4 angles d'approche, chacun appuyé sur un fait sourcé, puis rédige une première approche.

RÈGLES DE COLLECTE (impératives)
- Chaque coordonnée, décideur et fait porte l'adresse exacte de la page où tu l'as lu. Sans source, ne le mets pas.
- N'invente et ne reconstitue JAMAIS une adresse e-mail (pas de prénom.nom@domaine déduit), ni un numéro.
- Pas d'adresse ou de numéro personnel (gmail, hotmail, mobile privé publié ailleurs que dans un cadre professionnel).
- N'ouvre pas les pages LinkedIn, Facebook ou Instagram ; tu peux citer l'adresse d'un profil apparue dans les résultats de recherche.
- Si l'entreprise demande sur son site à ne pas être démarchée, indique-le dans « limites ».
- Qualification : niveau 0 à 3 par critère, « fait » seulement si une source le prouve, sinon « hypothese ».
${CRITERIA.filter((c) => !c.auto).map((c) => `  · ${c.k} — ${c.label} : ${c.levels.map((l, i) => `${i} ${l}`).join(" / ")}`).join("\n")}

RÈGLES DE RÉDACTION DE L'APPROCHE
${RULES}
- E-mail : 120 mots maximum, adressé au décideur si identifié, une seule question, un appel à l'action simple. Il cite la source de l'adresse en une phrase discrète et se termine par une phrase qui permet de refuser les relances. Signature : ${signature || "[Prénom Nom]"}.
- LinkedIn : 300 caractères maximum. Script d'appel : 6 lignes maximum, pour le standard puis le décideur.

FAITS PRODUIT CONFIRMÉS
${productFacts.length ? productFacts.map((f) => "- " + f).join("\n") : "- Aucun fait confirmé : décris seulement SwipSales comme une plateforme dédiée au recrutement commercial."}

Sois économe : 3 recherches et 3 pages au plus (commence par le site officiel : page Contact ou Mentions légales, puis Équipe ou Carrières), puis appelle l'outil ${SAVE_TOOL} une seule fois avec la fiche complète. Champs inconnus : chaîne ou liste vide.`;
}

// --- Contrôle de la sortie -----------------------------------------------------------------------

const FREEMAIL = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|orange|wanadoo|free|sfr|neuf|laposte|bbox|gmx|protonmail|proton)\./i;
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const httpUrl = (u: unknown): string => {
  const s = typeof u === "string" ? u.trim() : "";
  try { const x = new URL(s); return /^https?:$/.test(x.protocol) ? x.toString() : ""; } catch { return ""; }
};
const txt = (v: unknown, max = 600): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const block = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "");
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);
const isoDate = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");

/** Téléphone français au format +33 X XX XX XX XX ; vide si le numéro n'est pas exploitable. */
export function normalizePhone(v: string): string {
  let d = v.replace(/[^\d+]/g, "");
  if (d.startsWith("+33")) d = "0" + d.slice(3);
  else if (d.startsWith("0033")) d = "0" + d.slice(4);
  if (!/^0[1-9]\d{8}$/.test(d)) return d.startsWith("+") && d.length >= 10 ? d : "";
  return "+33 " + d.slice(1, 2) + " " + d.slice(2).replace(/(\d{2})(?=\d)/g, "$1 ");
}

export interface NormalizedResearch {
  dossier: ResearchDossier;
  patch: Partial<Prospect> & { drafts?: Record<string, unknown> | null };
}

/** Ne garde que l'exploitable et le sourcé, puis prépare la mise à jour de la fiche (sans écraser une saisie humaine). */
export function normalizeResearch(raw: unknown, p: Prospect, today: string): NormalizedResearch {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let rejected = 0;
  const website = httpUrl(r.site_web) || p.website;
  const siteDomain = domainOf(website);

  const contacts: PublicContact[] = [];
  for (const c of arr(r.contacts)) {
    const url = httpUrl(c.source_url), type = c.type as PublicContact["type"], owner = txt(c.titulaire, 120);
    let value = txt(c.valeur, 200);
    if (!url || !value || !["email", "telephone", "linkedin", "formulaire"].includes(type)) { rejected++; continue; }
    if (type === "email") {
      value = value.replace(/^mailto:/i, "").toLowerCase();
      if (!EMAIL.test(value) || FREEMAIL.test(value)) { rejected++; continue; }
    } else if (type === "telephone") {
      value = normalizePhone(value);
      if (!value) { rejected++; continue; }
    } else if (!httpUrl(value)) { rejected++; continue; }
    if (contacts.some((x) => x.type === type && x.value === value)) continue;
    contacts.push({ type, value, owner, url });
  }

  const decisionMakers: DecisionMaker[] = arr(r.decideurs)
    .map((d) => ({ name: txt(d.nom, 120), title: txt(d.fonction, 160), url: httpUrl(d.source_url) }))
    .filter((d) => (d.name && d.url ? true : (rejected++, false)));
  const facts = (list: unknown, key: string): SourcedFact[] => arr(list)
    .map((f) => ({ text: txt(f[key]), url: httpUrl(f.source_url), date: isoDate(f.date) }))
    .filter((f) => (f.text && f.url ? true : (rejected++, false)));
  const angles: Angle[] = arr(r.angles).map((a) => ({ angle: txt(a.angle, 300), basis: txt(a.appui, 300) })).filter((a) => a.angle);

  const dossier: ResearchDossier = {
    ...(p.research || {}),
    at: today,
    summary: txt(r.resume, 800),
    website,
    sector: txt(r.secteur, 160),
    decisionMakers,
    contacts,
    facts: facts(r.faits, "fait"),
    signals: facts(r.signaux, "signal"),
    angles,
    need: txt(r.besoin_suppose, 400),
    gaps: txt(r.limites, 600),
    rejected,
  };

  // Coordonnée principale : celle du décideur si publiée, sinon recrutement / RH, sinon générique, sinon standard.
  const lead = decisionMakers[0];
  const byOwner = (c: PublicContact) => (lead && c.owner.toLowerCase().includes(lead.name.split(" ").pop()!.toLowerCase()) ? 0 : /recrut|rh|ressources|job|carri/i.test(c.owner + c.value) ? 1 : 2);
  const emails = contacts.filter((c) => c.type === "email").sort((a, b) => byOwner(a) - byOwner(b) || Number(domainOf(b.value.split("@")[1]) === siteDomain) - Number(domainOf(a.value.split("@")[1]) === siteDomain));
  const phones = contacts.filter((c) => c.type === "telephone").sort((a, b) => byOwner(a) - byOwner(b));
  const linkedin = contacts.find((c) => c.type === "linkedin" && lead && byOwner(c) === 0) || contacts.find((c) => c.type === "linkedin");

  const patch: NormalizedResearch["patch"] = { research: dossier, researchStatus: "fait", researchedAt: new Date().toISOString() };
  if (!p.website && website) patch.website = website;
  if (!p.sector && dossier.sector) patch.sector = dossier.sector;
  if (!p.need && dossier.need) patch.need = dossier.need;
  if (lead && (!p.decisionName || !p.decisionVerified || p.origin === "france_travail" && p.decisionName === p.research?.registry?.officers?.[0]?.name)) {
    patch.decisionName = lead.name; patch.decisionTitle = lead.title; patch.decisionVerified = true;
  }
  const used: string[] = [];
  if (!p.email && emails[0]) { patch.email = emails[0].value; used.push(emails[0].url); }
  if (!p.phone && phones[0]) { patch.phone = phones[0].value; used.push(phones[0].url); }
  if (!p.linkedin && linkedin) { patch.linkedin = linkedin.value; used.push(linkedin.url); }
  if (used.length) patch.contactSource = [p.contactSource, ...new Set(used)].filter(Boolean).join(" ; ").slice(0, 900);
  if (!p.signal && dossier.signals?.[0]) { patch.signal = dossier.signals[0].text; patch.signalSource = dossier.signals[0].url; patch.signalDate = dossier.signals[0].date || today; }

  // Qualification : un critère déjà noté comme fait par un humain n'est pas remplacé.
  const q = (r.qualification && typeof r.qualification === "object" ? r.qualification : {}) as Record<string, { niveau?: unknown; base?: unknown }>;
  const crit: Record<string, Criterion> = { ...(p.crit || {}) };
  for (const c of CRITERIA.filter((x) => !x.auto)) {
    const v = Math.max(0, Math.min(3, Math.round(Number(q[c.k]?.niveau) || 0)));
    if (crit[c.k]?.b === "f" || q[c.k] === undefined) continue;
    crit[c.k] = { v, b: q[c.k]?.base === "fait" ? "f" : "h" };
  }
  patch.crit = crit;

  const a = (r.approche && typeof r.approche === "object" ? r.approche : {}) as Record<string, unknown>;
  if (block(a.email, 2000) && !(p as { drafts?: { validated?: boolean } }).drafts?.validated) {
    patch.drafts = {
      by: "claude", source: "recherche", generatedAt: today, validated: false,
      raw: [`Accroche : ${txt(a.accroche, 300)}`, `Objet : ${txt(a.email_objet, 200)}`, "", block(a.email, 2000), "", `LinkedIn : ${txt(a.linkedin, 400)}`, "", `Appel : ${block(a.script_appel, 1200)}`].join("\n"),
    };
  }
  return { dossier, patch };
}
