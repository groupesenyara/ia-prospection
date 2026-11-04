// Recherche web d'une entreprise par l'agent : consignes, format de sortie et contrôle de ce qui est conservé.
// Principe : on ne garde que des informations publiques, publiées par l'entreprise ou une source professionnelle,
// avec l'adresse de la page où elles ont été lues. Rien n'est deviné (pas d'e-mail reconstitué prénom.nom@).
import { checkClaims, type ConfirmedFact } from "./claims.js";
import { CRITERIA } from "./scoring.js";
import { factLines, RULES } from "./prompts.js";
import { domainOf } from "./dedup.js";
import type { Angle, Criterion, DecisionMaker, Prospect, PublicContact, ResearchDossier, SourcedFact, UnitEvaluation } from "./types.js";
import { playbookText, UNIT_IDS, UNITS, type UnitId } from "./units.js";

export type UnitFacts = Partial<Record<UnitId, ConfirmedFact[]>>;
/** Seuil de score à partir duquel un pôle ouvre une opportunité. */
export const OPPORTUNITY_THRESHOLD = 40;

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
    decideurs: { type: "array", items: sourced({ nom: S, fonction: S }), description: "Décideurs pour le pôle principal (dirigeant, directeur commercial, DRH, responsable formation, responsable des opérations…), nommés sur une source publique" },
    contacts: {
      type: "array",
      description: "Coordonnées PROFESSIONNELLES PUBLIÉES telles quelles. Jamais d'adresse reconstituée.",
      items: sourced({ type: { type: "string", enum: ["email", "telephone", "linkedin", "formulaire"] }, valeur: S, titulaire: { type: "string", description: "Nom et fonction de la personne, ou « standard », « service RH », « recrutement »" } }),
    },
    faits: { type: "array", items: sourced({ fait: S, date: { type: "string", description: "AAAA-MM-JJ ou chaîne vide" } }) },
    signaux: { type: "array", description: "Signaux d'achat récents et sourcés, tous pôles confondus", items: sourced({ signal: S, date: S }) },
    poles: {
      type: "array",
      description: "Évaluation de CHACUN des trois pôles (swipsales, amandis, northreef), une entrée par pôle",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pole: { type: "string", enum: ["swipsales", "amandis", "northreef"] },
          score: { type: "integer", description: "0 à 100 : pertinence d'une approche de ce pôle, d'après des signaux sourcés" },
          offre: { type: "string", description: "L'offre précise du catalogue du pôle à proposer, ou chaîne vide si aucune" },
          raison: { type: "string", description: "Pourquoi, en une phrase, en citant le signal" },
          signal: { type: "string", description: "Le signal principal pour ce pôle, ou chaîne vide" },
          source_url: { type: "string", description: "Source du signal, ou chaîne vide" },
        },
        required: ["pole", "score", "offre", "raison", "signal", "source_url"],
      },
    },
    pole_principal: { type: "string", enum: ["swipsales", "amandis", "northreef"], description: "Le pôle à solliciter en premier (un seul)" },
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
  required: ["site_web", "resume", "secteur", "decideurs", "contacts", "faits", "signaux", "poles", "pole_principal", "angles", "besoin_suppose", "qualification", "approche", "limites"],
} as const;

export function researchPrompt(p: Prospect, facts: UnitFacts): string {
  const r = p.research || {};
  const known = [
    `Entreprise : ${p.company}`,
    p.siren ? `SIREN : ${p.siren} (${r.registry?.url || "registre public"})` : "",
    p.city ? `Ville : ${p.city}` : "",
    p.website ? `Site connu : ${p.website}` : "",
    p.sector ? `Activité (registre) : ${p.sector}` : "",
    p.headcount ? `Effectif (registre) : ${p.headcount}` : "",
    r.registry?.officers?.length ? `Dirigeants (registre) : ${r.registry.officers.map((o) => `${o.name}, ${o.role}`).join(" ; ")}` : "",
    r.offers?.length ? `Offres d'emploi publiées :\n${r.offers.map((o) => `  - ${o.date} · ${o.title} · ${o.city} · ${o.url}`).join("\n")}` : p.signal ? `Signal : ${p.signal} (${p.signalSource})` : "",
  ].filter(Boolean).join("\n");
  return `Tu es l'agent commercial du Groupe Senyara. Le groupe a trois pôles, et un seul doit approcher l'entreprise en premier :
${UNIT_IDS.map((id) => `- ${id} = ${UNITS[id].name} : ${UNITS[id].pitch} Signaux : ${UNITS[id].signals.join(" ; ")}.`).join("\n")}

CE QUE L'ON SAIT DÉJÀ
${known}

TA MISSION
1. Trouve le site officiel, puis lis ses pages Contact ou Mentions légales, et si utile Équipe, Carrières ou Actualités.
2. Relève les coordonnées professionnelles PUBLIÉES : standard, e-mail générique (contact@, rh@, recrutement@), e-mail ou téléphone nominatif seulement s'il est publié tel quel dans un cadre professionnel, page LinkedIn de l'entreprise ou profil public du décideur, formulaire.
3. Comprends l'entreprise et relève les faits utiles : activité, clients, croissance, recrutements, outils et présence numérique (site récent ou daté, adapté au mobile ou non, HTTPS), processus visibles.
4. Évalue CHAQUE pôle (score 0 à 100, d'après des signaux sourcés, pas des suppositions), choisis l'offre précise du catalogue qui répond au besoin, puis désigne UN pôle principal. Ne propose pas tous les services : la meilleure opportunité d'abord.
5. Identifie le décideur pertinent pour le pôle principal, propose 2 à 4 angles d'approche appuyés sur des faits, puis rédige la première approche POUR LE PÔLE PRINCIPAL SEULEMENT.

RÈGLES DE COLLECTE (impératives)
- Chaque coordonnée, décideur, fait et signal porte l'adresse exacte de la page où tu l'as lu. Sans source, ne le mets pas.
- N'invente et ne reconstitue JAMAIS une adresse e-mail (pas de prénom.nom@domaine déduit), ni un numéro.
- Pas d'adresse ou de numéro personnel (gmail, hotmail, mobile privé publié ailleurs que dans un cadre professionnel).
- N'ouvre pas les pages LinkedIn, Facebook ou Instagram ; tu peux citer l'adresse d'un profil apparue dans les résultats de recherche.
- Si l'entreprise demande sur son site à ne pas être démarchée, indique-le dans « limites ».
- Qualification (critères Swipe Sales, garde-les même si un autre pôle est principal) : niveau 0 à 3, « fait » seulement si une source le prouve, sinon « hypothese ».
${CRITERIA.filter((c) => !c.auto).map((c) => `  · ${c.k} — ${c.label} : ${c.levels.map((l, i) => `${i} ${l}`).join(" / ")}`).join("\n")}

RÈGLES DE RÉDACTION DE L'APPROCHE (pôle principal)
${RULES}
- E-mail : 120 mots maximum, adressé au décideur si identifié, une seule question, un appel à l'action simple. Il cite la source de l'adresse en une phrase discrète et se termine par une phrase qui permet de refuser les relances. Signe avec la signature du pôle principal.
- LinkedIn : 300 caractères maximum (envoyé à la main). Script d'appel : 6 lignes maximum, pour le standard puis le décideur.

DOSSIERS DES PÔLES (seuls les faits confirmés peuvent être affirmés)
${UNIT_IDS.map((id) => `${playbookText(id, factLines(facts[id] || []))}\nSignature : ${UNITS[id].signature}`).join("\n\n")}

Sois économe : 3 recherches et 3 pages au plus (commence par le site officiel), puis appelle l'outil ${SAVE_TOOL} une seule fois avec la fiche complète. Champs inconnus : chaîne ou liste vide.`;
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

export interface OpportunityDraft { unit: UnitId; score: number; offer: string; reason: string; signal: string; signalSource: string; primary: boolean }

export interface NormalizedResearch {
  dossier: ResearchDossier;
  opportunities: OpportunityDraft[];
  patch: Partial<Prospect> & { drafts?: Record<string, unknown> | null };
}

/** Ne garde que l'exploitable et le sourcé, puis prépare la mise à jour de la fiche (sans écraser une saisie humaine). */
export function normalizeResearch(raw: unknown, p: Prospect, today: string, unitFacts: UnitFacts = {}): NormalizedResearch {
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

  // Pôles : un score par pôle, un seul pôle principal (le meilleur si l'agent n'en désigne pas de valide).
  const units: UnitEvaluation[] = UNIT_IDS.map((id) => {
    const e = arr(r.poles).find((x) => x.pole === id) || {};
    const signalSource = httpUrl(e.source_url);
    return { unit: id, score: Math.max(0, Math.min(100, Math.round(Number(e.score) || 0))), offer: txt(e.offre, 200), reason: txt(e.raison, 400), signal: signalSource ? txt(e.signal, 300) : "", signalSource };
  }).sort((a, b) => b.score - a.score);
  const primary = (UNIT_IDS as string[]).includes(String(r.pole_principal)) && units.find((u) => u.unit === r.pole_principal)!.score > 0 ? String(r.pole_principal) as UnitId : (units[0].score > 0 ? units[0].unit as UnitId : null);
  dossier.units = units;
  if (primary) dossier.primaryUnit = primary;
  const opportunities: OpportunityDraft[] = units
    .filter((u) => u.unit === primary || u.score >= OPPORTUNITY_THRESHOLD)
    .map((u) => ({ unit: u.unit as UnitId, score: u.score, offer: u.offer, reason: u.reason, signal: u.signal, signalSource: u.signalSource, primary: u.unit === primary }));

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
    const unit: UnitId = primary || "swipsales";
    const raw = [`Accroche : ${txt(a.accroche, 300)}`, `Objet : ${txt(a.email_objet, 200)}`, "", block(a.email, 2000), "", `LinkedIn : ${txt(a.linkedin, 400)}`, "", `Appel : ${block(a.script_appel, 1200)}`].join("\n");
    patch.drafts = { by: "claude", source: "recherche", unit, generatedAt: today, validated: false, raw, issues: checkClaims(raw, unitFacts[unit] || []) };
  }
  return { dossier, patch, opportunities };
}
