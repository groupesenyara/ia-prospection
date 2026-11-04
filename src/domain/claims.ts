// Garde-fou automatique sur les messages rédigés par l'IA : toute affirmation sensible (certification, financement,
// prix, référence client, chiffre de résultat, promesse, fausse urgence) doit être couverte par un fait CONFIRMÉ
// du pôle, du bon type et sur le même sujet. Sinon le brouillon est bloqué « À vérifier ».

export type FactKind = "offre" | "tarif" | "argument" | "reference" | "certification" | "interdit" | "cible";
export interface ConfirmedFact { kind: FactKind; text: string }
export interface ClaimIssue { rule: string; excerpt: string; hint: string }

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const digits = (s: string) => s.replace(/\D/g, "");

interface Rule {
  rule: string;
  hint: string;
  re: RegExp;
  kinds: FactKind[]; // types de faits qui peuvent couvrir l'affirmation ; vide = jamais couverte
  key: (match: string) => string; // ce que le fait doit contenir pour la couvrir ("" = tout fait du bon type)
}

const stem = (m: string) => norm(m).replace(/[^a-z ]/g, "").trim().split(" ")[0].slice(0, 7);

const RULES: Rule[] = [
  { rule: "certification", hint: "Certification ou label non confirmé", re: /\b(qualiopi|certifi\w*|rncp|r[ée]pertoire sp[ée]cifique|labellis\w*|datadock)\b/gi, kinds: ["certification"], key: stem },
  { rule: "financement", hint: "Financement ou éligibilité non confirmé", re: /\b(opco|cpf|fne|prise en charge|financ[ée]\w*|financement\w*|[ée]ligib\w+|rembours\w+|z[ée]ro reste [àa] charge)\b/gi, kinds: ["certification", "offre", "tarif"], key: stem },
  { rule: "prix", hint: "Prix non confirmé", re: /\d[\d\s.,]*\s?(€|euros?\b|k€)|\b(tarif|prix)\s+(de\s+)?\d[\d\s.,]*/gi, kinds: ["tarif"], key: digits },
  { rule: "référence", hint: "Référence ou volume client non confirmé", re: /\b(nos clients?|nous avons (accompagn|aid|form|travaill)\w*|ils nous font confiance|d[ée]j[àa] \d+|plus de \d+ (entreprises|clients|stagiaires|apprenants|utilisateurs|candidats))/gi, kinds: ["reference"], key: (m) => digits(m) },
  { rule: "résultat", hint: "Chiffre ou promesse de résultat non confirmé", re: /\d+[.,]?\d*\s?%|\b(garanti\w*|assur[ée]ment|sans risque|r[ée]sultats? imm[ée]diats?|doublez|triplez|multipliez)\b/gi, kinds: ["argument"], key: (m) => (/\d/.test(m) ? digits(m) : stem(m)) },
  { rule: "urgence", hint: "Urgence ou rareté artificielle", re: /\b(derni[èe]res? places?|offre limit[ée]e|plus que \d+ places?|expire (ce soir|demain|aujourd'hui))\b/gi, kinds: [], key: () => "" },
];

/** Affirmations du texte qu'aucun fait confirmé du bon type ne couvre. */
export function checkClaims(text: string, confirmed: ConfirmedFact[]): ClaimIssue[] {
  const out: ClaimIssue[] = [];
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      const key = r.key(m[0]);
      const covered = confirmed.some((f) => r.kinds.includes(f.kind) && (key === "" || (r.key === digits ? digits(f.text) : norm(f.text)).includes(key)));
      if (covered) continue;
      const i = m.index ?? 0;
      const excerpt = text.slice(Math.max(0, i - 30), i + m[0].length + 30).replace(/\s+/g, " ").trim();
      if (!out.some((x) => x.rule === r.rule && x.excerpt === excerpt)) out.push({ rule: r.rule, excerpt, hint: r.hint });
    }
  }
  return out;
}

/** Un brouillon avec au moins une affirmation non couverte ne peut pas être validé tel quel. */
export const canValidateDraft = (text: string, confirmed: ConfirmedFact[]): boolean => checkClaims(text, confirmed).length === 0;
