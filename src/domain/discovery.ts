// Détection des entreprises qui recrutent des commerciaux, à partir des offres publiées sur France Travail,
// puis rapprochement avec le registre public des entreprises (SIRENE, via l'API Recherche d'entreprises).
// Fonctions pures : les appels réseau sont dans api/_lib.
import { normName } from "./dedup.js";
import type { Criterion, Prospect, ResearchDossier } from "./types.js";

/** Métiers commerciaux du ROME (France Travail). */
export const SALES_ROME = ["D1401", "D1402", "D1403", "D1404", "D1406", "D1407", "D1408"] as const;

export interface JobOffer {
  id: string;
  title: string;
  company: string;
  companyUrl: string;
  city: string;
  postalCode: string;
  rome: string;
  contract: string;
  publishedAt: string; // AAAA-MM-JJ
  url: string;
  excerpt: string;
  headcountLabel: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Réponse de GET /offresdemploi/v2/offres/search. Les offres anonymes (sans nom d'entreprise) sont écartées. */
export function parseFranceTravail(body: unknown): JobOffer[] {
  const list = Array.isArray(obj(body).resultats) ? (obj(body).resultats as unknown[]) : [];
  const out: JobOffer[] = [];
  for (const raw of list) {
    const r = obj(raw), ent = obj(r.entreprise), lieu = obj(r.lieuTravail), orig = obj(r.origineOffre);
    const company = str(ent.nom), id = str(r.id);
    if (!company || !id) continue;
    out.push({
      id,
      title: str(r.intitule),
      company,
      companyUrl: str(ent.url),
      city: str(lieu.libelle).replace(/^\d+\s*-\s*/, ""),
      postalCode: str(lieu.codePostal),
      rome: str(r.romeCode),
      contract: str(r.typeContrat),
      publishedAt: str(r.dateCreation).slice(0, 10),
      url: str(orig.urlOrigine) || `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(id)}`,
      excerpt: str(r.description).replace(/\s+/g, " ").slice(0, 600),
      headcountLabel: str(r.trancheEffectifEtab),
    });
  }
  return out;
}

/** Agences d'intérim et de placement : elles publient pour leurs clients, ce ne sont pas des recruteurs directs. */
const STAFFING = /\b(int[ée]rim|travail temporaire|randstad|adecco|manpower|synergie|crit|start people|proman|samsic emploi|partnaire|supplay|gojob|staffme|side|hays|expectra|page personnel|michael page|robert walters|spring|walters people|fed ?(business|group)|lincoln|axcess|sauvage|leaderinterim|leader interim)\b/i;
export const isStaffing = (o: Pick<JobOffer, "company" | "excerpt">): boolean => STAFFING.test(o.company) || /\bpour (le compte de )?(l'un de )?(nos|notre) client/i.test(o.excerpt);

export interface CompanyGroup { key: string; company: string; companyUrl: string; postalCode: string; city: string; offers: JobOffer[] }

export function groupByCompany(offers: JobOffer[]): CompanyGroup[] {
  const m = new Map<string, CompanyGroup>();
  for (const o of offers) {
    if (isStaffing(o)) continue;
    const key = normName(o.company);
    if (!key) continue;
    const g = m.get(key) || { key, company: o.company, companyUrl: o.companyUrl, postalCode: o.postalCode, city: o.city, offers: [] };
    if (!g.offers.some((x) => x.id === o.id)) g.offers.push(o);
    g.companyUrl ||= o.companyUrl;
    m.set(key, g);
  }
  return [...m.values()];
}

/**
 * Entreprises nouvelles à étudier : pas déjà en base (même nom, même site ou même SIREN connu),
 * classées par nombre d'offres commerciales puis par fraîcheur de la dernière offre.
 */
export function pickCandidates(groups: CompanyGroup[], existing: Pick<Prospect, "company" | "website">[], limit: number): CompanyGroup[] {
  const known = new Set(existing.map((p) => normName(p.company)).filter(Boolean));
  const last = (g: CompanyGroup) => g.offers.reduce((d, o) => (o.publishedAt > d ? o.publishedAt : d), "");
  return groups
    .filter((g) => !known.has(g.key))
    .sort((a, b) => b.offers.length - a.offers.length || last(b).localeCompare(last(a)))
    .slice(0, Math.max(0, limit));
}

// --- Registre des entreprises -------------------------------------------------------------------

/** Tranches d'effectif INSEE. Cible : PME de 10 à 249 salariés. */
export const HEADCOUNT: Record<string, string> = {
  "00": "0 salarié", "01": "1 à 2", "02": "3 à 5", "03": "6 à 9", "11": "10 à 19", "12": "20 à 49", "21": "50 à 99",
  "22": "100 à 199", "31": "200 à 249", "32": "250 à 499", "41": "500 à 999", "42": "1 000 à 1 999", "51": "2 000 à 4 999", "52": "5 000 à 9 999", "53": "10 000 et plus",
};
export const TARGET_HEADCOUNT = ["11", "12", "21", "22", "31"];

export interface Firm {
  siren: string;
  name: string;
  naf: string;
  nafLabel: string;
  headcountCode: string;
  category: string;
  city: string;
  postalCode: string;
  created: string;
  active: boolean;
  officers: { name: string; role: string }[];
}

/** Réponse de GET recherche-entreprises.api.gouv.fr/search. */
export function parseFirms(body: unknown): Firm[] {
  const list = Array.isArray(obj(body).results) ? (obj(body).results as unknown[]) : [];
  return list.map((raw) => {
    const r = obj(raw), siege = obj(r.siege);
    const officers = (Array.isArray(r.dirigeants) ? (r.dirigeants as unknown[]) : [])
      .map(obj)
      .filter((d) => str(d.type_dirigeant) !== "personne morale" && (str(d.nom) || str(d.prenoms)))
      .map((d) => ({ name: [str(d.prenoms).split(" ")[0], str(d.nom)].filter(Boolean).join(" ").replace(/\b([A-ZÀ-Ý])([A-ZÀ-Ý'-]+)/g, (_, a: string, b: string) => a + b.toLowerCase()), role: str(d.qualite) }));
    return {
      siren: str(r.siren),
      name: str(r.nom_complet) || str(r.nom_raison_sociale),
      naf: str(r.activite_principale) || str(siege.activite_principale),
      nafLabel: str(r.libelle_activite_principale) || str(siege.libelle_activite_principale),
      headcountCode: str(r.tranche_effectif_salarie) || str(siege.tranche_effectif_salarie),
      category: str(r.categorie_entreprise),
      city: str(siege.libelle_commune),
      postalCode: str(siege.code_postal),
      created: str(r.date_creation),
      active: (str(r.etat_administratif) || "A") === "A",
      officers,
    };
  });
}

const dept = (cp: string) => (cp.startsWith("97") ? cp.slice(0, 3) : cp.slice(0, 2));

/** Choisit la fiche du registre qui correspond à l'entreprise de l'offre : active, nom proche, même département si possible. */
export function matchFirm(g: Pick<CompanyGroup, "company" | "postalCode">, firms: Firm[]): Firm | null {
  const n = normName(g.company);
  if (!n) return null;
  const close = firms.filter((f) => f.active && /^\d{9}$/.test(f.siren) && (normName(f.name) === n || normName(f.name).startsWith(n) || n.startsWith(normName(f.name))));
  if (!close.length) return null;
  return close.find((f) => g.postalCode && dept(f.postalCode) === dept(g.postalCode)) || close[0];
}

/** PME de 10 à 249 salariés. Effectif non diffusé : accepté, à confirmer par la recherche. */
export const inTargetSize = (f: Pick<Firm, "headcountCode" | "category">): boolean =>
  TARGET_HEADCOUNT.includes(f.headcountCode) || (!f.headcountCode || f.headcountCode === "NN") && f.category !== "GE" && f.category !== "ETI";

// --- Fiche créée -----------------------------------------------------------------------------

const volumeLevel = (n: number) => (n >= 4 ? 3 : n >= 2 ? 2 : 1);

/** Fiche CRM à partir des offres et du registre. Tout ce qui y figure est un fait sourcé. */
export function prospectFromDiscovery(g: CompanyGroup, firm: Firm | null, today: string, origin: "france_travail" | "web" = "france_travail"): Partial<Prospect> {
  const offers = [...g.offers].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const latest = offers[0];
  const titles = [...new Set(offers.map((o) => o.title).filter(Boolean))].slice(0, 5).join(" ; ");
  const registryUrl = firm ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${firm.siren}` : "";
  const boss = firm?.officers[0];
  const crit: Record<string, Criterion> = {
    volume: { v: volumeLevel(offers.length), b: "f" },
    pertinence: { v: offers.length > 1 && new Set(offers.map((o) => o.rome)).size > 1 ? 3 : 2, b: "f" },
  };
  const registry: ResearchDossier["registry"] = firm
    ? { siren: firm.siren, name: firm.name, naf: [firm.naf, firm.nafLabel].filter(Boolean).join(" "), headcount: HEADCOUNT[firm.headcountCode] || "non diffusé", city: firm.city, created: firm.created, url: registryUrl, officers: firm.officers.slice(0, 5) }
    : undefined;
  return {
    company: firm?.name ? titleCase(firm.name) : g.company,
    website: g.companyUrl,
    kind: "Entreprise qui recrute",
    roles: titles,
    source: latest.url,
    verifiedAt: today,
    sector: firm?.nafLabel || "",
    size: firm && HEADCOUNT[firm.headcountCode] ? `${HEADCOUNT[firm.headcountCode]} salariés` : "Inconnue",
    decisionName: boss?.name || "",
    decisionTitle: boss?.role || "",
    decisionVerified: !!boss,
    signal: `${offers.length} offre${offers.length > 1 ? "s" : ""} commerciale${offers.length > 1 ? "s" : ""} publiée${offers.length > 1 ? "s" : ""}${origin === "france_travail" ? " sur France Travail" : ""} (dernière : ${latest.title})`,
    signalSource: latest.url,
    signalDate: latest.publishedAt,
    crit,
    stage: "Entreprise identifiée",
    siren: firm?.siren || null,
    city: firm?.city || g.city,
    headcount: firm ? HEADCOUNT[firm.headcountCode] || "non diffusé" : "",
    naf: firm?.naf || "",
    origin,
    researchStatus: "à rechercher",
    research: { registry, offers: offers.slice(0, 10).map((o) => ({ title: o.title, url: o.url, date: o.publishedAt, city: o.city })) },
  };
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_, a: string, b: string) => a + b.toUpperCase()) : s);

// --- Détection par recherche web (sans compte France Travail) -------------------------------------

export const SAVE_OFFERS = "enregistrer_offres";

/** Un thème par jour pour varier les résultats sans multiplier les recherches. */
export const WEB_THEMES = [
  "SDR ou BDR (prospection, rendez-vous)",
  "commercial terrain ou chargé d'affaires",
  "business developer ou account executive en PME",
  "technico-commercial ou ingénieur commercial",
  "commercial sédentaire ou conseiller commercial B2B",
] as const;
export const themeOf = (isoDay: string): string => WEB_THEMES[Math.floor(new Date(isoDay + "T12:00:00Z").getTime() / 864e5) % WEB_THEMES.length];

export const offersSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    offres: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          entreprise: { type: "string", description: "Nom de l'entreprise qui recrute (jamais une agence d'intérim ou un cabinet qui recrute pour un client)" },
          poste: { type: "string" },
          ville: { type: "string" },
          date: { type: "string", description: "Date de publication AAAA-MM-JJ, ou chaîne vide" },
          url: { type: "string", description: "Adresse de l'annonce telle qu'elle apparaît dans les résultats" },
        },
        required: ["entreprise", "poste", "ville", "date", "url"],
      },
    },
  },
  required: ["offres"],
} as const;

export function webDiscoveryPrompt(today: string, want: number, exclude: string[]): string {
  return `Nous sommes le ${today}. Trouve des annonces d'emploi publiques, publiées en France depuis moins de 15 jours, pour des postes commerciaux : ${themeOf(today)}.
Cible : PME françaises de 10 à 250 salariés qui recrutent elles-mêmes. Écarte les agences d'intérim, les cabinets de recrutement, les grands groupes et les annonces sans nom d'entreprise.
Utilise uniquement les résultats de recherche (job boards, pages carrières, Welcome to the Jungle, Indeed, HelloWork, APEC, France Travail…). Ne lis pas les pages.
${exclude.length ? `Ignore ces entreprises déjà connues : ${exclude.slice(0, 60).join(", ")}.\n` : ""}Vise ${want * 2} entreprises différentes, une ligne par annonce, avec l'adresse exacte de l'annonce. N'invente rien : pas d'annonce sans adresse.
Puis appelle l'outil ${SAVE_OFFERS} une seule fois.`;
}

/** Sortie de l'agent -> offres au même format que France Travail (l'adresse de l'annonce sert d'identifiant). */
export function offersFromWeb(raw: unknown, today: string): JobOffer[] {
  const list = Array.isArray(obj(raw).offres) ? (obj(raw).offres as unknown[]) : [];
  const out: JobOffer[] = [];
  for (const x of list.map(obj)) {
    const company = str(x.entreprise), url = str(x.url);
    if (!company || !/^https?:\/\//i.test(url) || out.some((o) => o.id === url)) continue;
    const date = /^\d{4}-\d{2}-\d{2}/.test(str(x.date)) ? str(x.date).slice(0, 10) : today;
    out.push({ id: url, title: str(x.poste).slice(0, 160), company: company.slice(0, 160), companyUrl: "", city: str(x.ville).slice(0, 80), postalCode: "", rome: "", contract: "", publishedAt: date, url, excerpt: "", headcountLabel: "" });
  }
  return out;
}

// --- Détection par le registre officiel (gratuite), pôle par pôle ----------------------------------

export interface RegistryTarget { label: string; naf: string[]; tranches: string[] }

/** Activités (codes NAF) et tailles visées par pôle. Le registre est gratuit : la détection ne coûte rien. */
export const REGISTRY_TARGETS: Record<"swipsales" | "amandis" | "northreef", RegistryTarget> = {
  swipsales: {
    label: "cabinets de recrutement, ESN, distribution et conseil B2B (10 à 249 salariés)",
    naf: ["78.10Z", "78.30Z", "62.02A", "62.01Z", "46.69B", "46.90Z", "70.22Z", "73.11Z", "46.51Z", "68.31Z"],
    tranches: ["11", "12", "21", "22", "31"],
  },
  amandis: {
    label: "PME de services et de distribution (20 à 249 salariés) et organismes de formation",
    naf: ["70.22Z", "62.02A", "69.20Z", "68.31Z", "66.22Z", "46.90Z", "82.99Z", "85.59A", "73.11Z", "71.12B"],
    tranches: ["12", "21", "22", "31"],
  },
  northreef: {
    label: "artisans, commerces, restaurants, garages, professions libérales et TPE locales",
    naf: ["43.21A", "43.22A", "43.32A", "43.34Z", "43.99C", "45.20A", "47.76Z", "47.78C", "56.10A", "56.10C", "96.02A", "96.04Z", "71.11Z", "86.23Z", "93.13Z", "55.10Z", "47.71Z", "81.21Z"],
    tranches: ["01", "02", "03", "11", "12"],
  },
};

/** Départements de métropole et d'outre-mer, pour la rotation quand aucun département n'est imposé. */
export const DEPARTEMENTS = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "2A", "2B", "21", "22", "23", "24", "25", "26", "27", "28", "29",
  "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59",
  "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "90", "91", "92", "93", "94", "95", "971", "972", "973", "974", "976",
];

const dayIndex = (isoDay: string) => Math.floor(new Date(isoDay + "T12:00:00Z").getTime() / 864e5);

/** Départements du jour : ceux imposés dans les réglages, sinon 3 départements qui tournent chaque jour sur toute la France. */
export function departementsOf(isoDay: string, imposed: string[]): string[] {
  const clean = imposed.map((d) => d.trim().toUpperCase()).filter((d) => DEPARTEMENTS.includes(d));
  if (clean.length) return clean;
  const i = (dayIndex(isoDay) * 3) % DEPARTEMENTS.length;
  return [0, 1, 2].map((k) => DEPARTEMENTS[(i + k) % DEPARTEMENTS.length]);
}

/** Ordre des activités tourné chaque jour, pour ne pas toujours interroger les mêmes. */
export const rotate = <T>(list: T[], isoDay: string): T[] => { const k = dayIndex(isoDay) % list.length; return [...list.slice(k), ...list.slice(0, k)]; };

/** Fiche CRM créée depuis le registre : identité, activité, effectif et dirigeants, tous sourcés. Pas encore de signal. */
export function prospectFromFirm(firm: Firm, unit: keyof typeof REGISTRY_TARGETS, today: string): Partial<Prospect> {
  const url = `https://annuaire-entreprises.data.gouv.fr/entreprise/${firm.siren}`;
  const boss = firm.officers[0];
  return {
    company: titleCase(firm.name),
    website: "",
    kind: "Entreprise qui recrute",
    roles: "",
    source: url,
    verifiedAt: today,
    sector: firm.nafLabel || firm.naf,
    size: HEADCOUNT[firm.headcountCode] ? `${HEADCOUNT[firm.headcountCode]} salariés` : "Inconnue",
    decisionName: boss?.name || "",
    decisionTitle: boss?.role || "",
    decisionVerified: !!boss,
    crit: {},
    stage: "Entreprise identifiée",
    siren: firm.siren,
    city: firm.city,
    headcount: HEADCOUNT[firm.headcountCode] || "non diffusé",
    naf: firm.naf,
    origin: `registre_${unit}`,
    assignedBy: unit === "swipsales" ? "legacy" : "orchestrateur",
    researchStatus: "à rechercher",
    research: { registry: { siren: firm.siren, name: firm.name, naf: [firm.naf, firm.nafLabel].filter(Boolean).join(" "), headcount: HEADCOUNT[firm.headcountCode] || "non diffusé", city: firm.city, created: firm.created, url, officers: firm.officers.slice(0, 5) } },
  } as Partial<Prospect>;
}
