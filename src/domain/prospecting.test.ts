import { describe, expect, it } from "vitest";
import { departementsOf, prospectFromFirm, REGISTRY_TARGETS, groupByCompany, inTargetSize, isStaffing, matchFirm, offersFromWeb, parseFirms, parseFranceTravail, pickCandidates, prospectFromDiscovery, themeOf, webDiscoveryPrompt, WEB_THEMES } from "./discovery.js";
import { prospectFacts } from "./prompts.js";
import { normalizePhone, normalizeResearch, researchPrompt } from "./research.js";
import type { Prospect } from "./types.js";

const ft = (over: Record<string, unknown> = {}) => ({
  id: "180ABC", intitule: "Business Developer H/F", description: "Rejoignez notre équipe commerciale…", dateCreation: "2026-11-02T08:00:00.000Z",
  lieuTravail: { libelle: "69 - LYON 03", codePostal: "69003" }, romeCode: "D1402", typeContrat: "CDI",
  entreprise: { nom: "ACME SOLUTIONS", url: "https://acme.fr" }, origineOffre: { urlOrigine: "https://candidat.francetravail.fr/offres/recherche/detail/180ABC" },
  trancheEffectifEtab: "20 à 49 salariés", ...over,
});
const firmRow = (over: Record<string, unknown> = {}) => ({
  siren: "123456789", nom_complet: "ACME SOLUTIONS", activite_principale: "62.01Z", tranche_effectif_salarie: "12", categorie_entreprise: "PME",
  etat_administratif: "A", date_creation: "2015-03-01", siege: { libelle_commune: "LYON", code_postal: "69003" },
  dirigeants: [{ nom: "MARTIN", prenoms: "Claire Anne", qualite: "Président", type_dirigeant: "personne physique" }, { denomination: "HOLDING X", type_dirigeant: "personne morale" }], ...over,
});

describe("détection France Travail", () => {
  it("lit les offres, écarte les anonymes et les agences d'intérim", () => {
    const offers = parseFranceTravail({ resultats: [ft(), ft({ id: "2", entreprise: {} }), ft({ id: "3", entreprise: { nom: "Randstad" } }), ft({ id: "4", entreprise: { nom: "Petit Cabinet" }, description: "Pour le compte de notre client, PME lyonnaise…" })] });
    expect(offers).toHaveLength(3);
    expect(offers[0]).toMatchObject({ company: "ACME SOLUTIONS", city: "LYON 03", publishedAt: "2026-11-02", rome: "D1402" });
    const groups = groupByCompany(offers);
    expect(groups.map((g) => g.company)).toEqual(["ACME SOLUTIONS"]);
    expect(isStaffing({ company: "Adecco Lyon", excerpt: "" })).toBe(true);
  });

  it("regroupe par entreprise et priorise le volume puis la fraîcheur ; ignore les entreprises déjà en base", () => {
    const offers = parseFranceTravail({ resultats: [
      ft(), ft({ id: "5", intitule: "SDR", romeCode: "D1406" }),
      ft({ id: "6", entreprise: { nom: "Beta SAS" }, dateCreation: "2026-11-03T08:00:00Z" }),
      ft({ id: "7", entreprise: { nom: "Gamma" } }),
    ] });
    const picked = pickCandidates(groupByCompany(offers), [{ company: "Gamma", website: "" }], 5);
    expect(picked.map((g) => [g.company, g.offers.length])).toEqual([["ACME SOLUTIONS", 2], ["Beta SAS", 1]]);
  });
});

describe("registre des entreprises", () => {
  it("rapproche l'offre du bon SIREN, actif, même département", () => {
    const firms = parseFirms({ results: [firmRow({ siren: "111111111", siege: { code_postal: "75008", libelle_commune: "PARIS" } }), firmRow(), firmRow({ siren: "999999999", etat_administratif: "C" })] });
    expect(firms[1].officers).toEqual([{ name: "Claire Martin", role: "Président" }]);
    expect(matchFirm({ company: "Acme Solutions", postalCode: "69003" }, firms)?.siren).toBe("123456789");
    expect(matchFirm({ company: "Autre chose", postalCode: "69003" }, firms)).toBeNull();
  });
  it("cible les PME de 10 à 249 salariés", () => {
    expect(inTargetSize({ headcountCode: "12", category: "PME" })).toBe(true);
    expect(inTargetSize({ headcountCode: "02", category: "PME" })).toBe(false);
    expect(inTargetSize({ headcountCode: "41", category: "ETI" })).toBe(false);
    expect(inTargetSize({ headcountCode: "NN", category: "PME" })).toBe(true);
  });
  it("crée une fiche dont tout est sourcé, prête pour la recherche", () => {
    const g = groupByCompany(parseFranceTravail({ resultats: [ft(), ft({ id: "5", intitule: "SDR", romeCode: "D1406", dateCreation: "2026-11-03T08:00:00Z" })] }))[0];
    const p = prospectFromDiscovery(g, parseFirms({ results: [firmRow()] })[0], "2026-11-04");
    expect(p).toMatchObject({
      company: "Acme Solutions", siren: "123456789", size: "20 à 49 salariés", decisionName: "Claire Martin", decisionTitle: "Président",
      signalDate: "2026-11-03", researchStatus: "à rechercher", origin: "france_travail", stage: "Entreprise identifiée",
      crit: { volume: { v: 2, b: "f" }, pertinence: { v: 3, b: "f" } },
    });
    expect(p.signal).toMatch(/^2 offres commerciales/);
    expect(p.source).toMatch(/^https:\/\/candidat\.francetravail\.fr/);
    expect(p.research?.registry?.url).toBe("https://annuaire-entreprises.data.gouv.fr/entreprise/123456789");
  });
});

const prospect = (o: Partial<Prospect> = {}): Prospect => ({
  id: "p1", company: "Acme Solutions", website: "", sector: "", size: "Inconnue", kind: "Entreprise qui recrute", roles: "SDR", source: "https://ft", verifiedAt: "2026-11-04",
  decisionName: "Claire Martin", decisionTitle: "Président", decisionVerified: true, email: "", linkedin: "", phone: "", contactSource: "",
  signal: "", signalSource: "", signalDate: "", need: "", crit: { volume: { v: 2, b: "f" } }, stage: "Entreprise identifiée", nextAction: "", nextDate: "",
  stripeSubId: "", stripeVerified: false, optOut: false, notes: "", segment: "", commsConsent: false, commsConsentDate: "",
  partnerStatus: "Identifié", partnerModel: "", conventionOk: false, partnerNotes: "", trialStart: "", trialEnd: "", engagementOk: false,
  offerPublished: false, offerDate: "", feedbackScore: null, feedbackNotes: "", referenceOk: false, campaignId: null, enrolledAt: "", campaignState: "",
  origin: "france_travail", research: { registry: { siren: "123456789", name: "ACME", naf: "62.01Z", headcount: "20 à 49", city: "Lyon", created: "", url: "https://annuaire", officers: [{ name: "Claire Martin", role: "Président" }] } },
  ...o,
});

const agentOutput = {
  site_web: "https://www.acme.fr",
  resume: "Éditeur de logiciels pour le BTP, 40 salariés, basé à Lyon.",
  secteur: "Logiciel",
  decideurs: [{ nom: "Paul Durand", fonction: "Directeur commercial", source_url: "https://www.acme.fr/equipe" }, { nom: "Sans Source", fonction: "DRH", source_url: "" }],
  contacts: [
    { type: "email", valeur: "contact@acme.fr", titulaire: "standard", source_url: "https://www.acme.fr/contact" },
    { type: "email", valeur: "recrutement@acme.fr", titulaire: "recrutement", source_url: "https://www.acme.fr/carrieres" },
    { type: "email", valeur: "p.durand@acme.fr", titulaire: "Paul Durand, directeur commercial", source_url: "https://www.acme.fr/equipe" },
    { type: "email", valeur: "paul.durand@gmail.com", titulaire: "Paul Durand", source_url: "https://forum.example" },
    { type: "email", valeur: "devine@acme.fr", titulaire: "Paul Durand", source_url: "" },
    { type: "telephone", valeur: "04 78 00 00 00", titulaire: "standard", source_url: "https://www.acme.fr/mentions-legales" },
    { type: "telephone", valeur: "pas un numéro", titulaire: "standard", source_url: "https://www.acme.fr" },
    { type: "linkedin", valeur: "https://www.linkedin.com/in/pauldurand", titulaire: "Paul Durand", source_url: "https://www.google.com/search?q=paul+durand" },
  ],
  faits: [{ fait: "Levée de 3 M€ en septembre 2026", source_url: "https://presse.example/acme", date: "2026-09-15" }, { fait: "Non sourcé", source_url: "", date: "" }],
  signaux: [{ signal: "Ouverture d'une agence à Paris", source_url: "https://www.acme.fr/actus", date: "2026-10-01" }],
  angles: [{ angle: "Accompagner la montée en charge commerciale après la levée", appui: "Levée de 3 M€" }],
  besoin_suppose: "Recruter 3 commerciaux rapidement",
  qualification: { volume: { niveau: 3, base: "fait" }, pertinence: { niveau: 9, base: "fait" }, fit: { niveau: 2, base: "hypothese" }, access: { niveau: 2, base: "fait" }, recurrence: { niveau: 2, base: "hypothese" } },
  approche: { accroche: "Félicitations pour la levée", email_objet: "Vos recrutements commerciaux", email: "Bonjour Paul,\n\nJ'ai vu votre levée.\n\nYannis", script_appel: "Bonjour…", linkedin: "Bonjour Paul" },
  limites: "Pas de téléphone direct du décideur.",
};

describe("contrôle de la recherche IA", () => {
  it("ne garde que les coordonnées publiées, sourcées, professionnelles", () => {
    const { dossier, patch } = normalizeResearch(agentOutput, prospect(), "2026-11-04");
    expect(dossier.contacts!.map((c) => c.value)).toEqual(["contact@acme.fr", "recrutement@acme.fr", "p.durand@acme.fr", "+33 4 78 00 00 00", "https://www.linkedin.com/in/pauldurand"]);
    expect(dossier.decisionMakers).toEqual([{ name: "Paul Durand", title: "Directeur commercial", url: "https://www.acme.fr/equipe" }]);
    expect(dossier.facts).toHaveLength(1);
    expect(dossier.rejected).toBe(5); // gmail, e-mail sans source, numéro invalide, décideur sans source, fait sans source
    expect(dossier.registry?.siren).toBe("123456789"); // le registre est conservé
    // fiche : e-mail du décideur en priorité, standard, LinkedIn, sources tracées
    expect(patch).toMatchObject({ email: "p.durand@acme.fr", phone: "+33 4 78 00 00 00", linkedin: "https://www.linkedin.com/in/pauldurand", website: "https://www.acme.fr/", decisionName: "Paul Durand", decisionTitle: "Directeur commercial", researchStatus: "fait", signal: "Ouverture d'une agence à Paris" });
    expect(patch.contactSource).toContain("https://www.acme.fr/equipe");
    // qualification : le fait humain est conservé, le reste est borné
    expect(patch.crit).toMatchObject({ volume: { v: 2, b: "f" }, pertinence: { v: 3, b: "f" }, fit: { v: 2, b: "h" } });
    expect(String(patch.drafts?.raw)).toContain("Bonjour Paul,\n\nJ'ai vu votre levée.");
  });

  it("n'écrase pas une saisie humaine ni des messages déjà validés", () => {
    const p = prospect({ email: "yannis-a-saisi@acme.fr", contactSource: "carte de visite", decisionName: "Claire Martin", origin: "manuel" });
    const { patch } = normalizeResearch(agentOutput, { ...p, drafts: { validated: true } } as Prospect, "2026-11-04");
    expect(patch.email).toBeUndefined();
    expect(patch.decisionName).toBeUndefined();
    expect(patch.drafts).toBeUndefined();
    expect(patch.contactSource).toBe("carte de visite ; https://www.acme.fr/mentions-legales ; https://www.google.com/search?q=paul+durand");
  });

  it("normalise les numéros français", () => {
    expect(normalizePhone("04.78.00.00.00")).toBe("+33 4 78 00 00 00");
    expect(normalizePhone("+33 (0)1 23 45 67 89".replace("(0)", ""))).toBe("+33 1 23 45 67 89");
    expect(normalizePhone("123")).toBe("");
  });

  it("le dossier sourcé nourrit la rédaction personnalisée", () => {
    const { patch } = normalizeResearch(agentOutput, prospect(), "2026-11-04");
    const facts = prospectFacts({ ...prospect(), ...patch } as Prospect);
    expect(facts).toContain("Levée de 3 M€ en septembre 2026 [FAIT, source : https://presse.example/acme, 2026-09-15]");
    expect(facts).toContain("Angle d’approche possible");
    const prompt = researchPrompt(prospect(), { swipsales: [{ kind: "offre", text: "Plateforme réservée aux commerciaux" }] });
    expect(prompt).toContain("[offre] Plateforme réservée aux commerciaux");
    expect(prompt).toContain("Signature : Yannis Sénéchal, Amandis School");
    expect(prompt).toContain("N'invente et ne reconstitue JAMAIS une adresse e-mail");
    expect(prompt).toContain("Claire Martin, Président");
  });
});

describe("détection par recherche web", () => {
  it("garde les annonces avec entreprise et adresse, sans doublon ; date du jour à défaut", () => {
    const offers = offersFromWeb({ offres: [
      { entreprise: "Acme", poste: "SDR", ville: "Lyon", date: "2026-11-01", url: "https://www.welcometothejungle.com/fr/companies/acme/jobs/sdr" },
      { entreprise: "Acme", poste: "SDR", ville: "Lyon", date: "", url: "https://www.welcometothejungle.com/fr/companies/acme/jobs/sdr" },
      { entreprise: "", poste: "Commercial", ville: "Paris", date: "", url: "https://x.fr/1" },
      { entreprise: "Sans Lien", poste: "Commercial", ville: "Paris", date: "", url: "" },
      { entreprise: "Beta", poste: "Commercial terrain", ville: "Nantes", date: "", url: "https://www.hellowork.com/fr-fr/emplois/1.html" },
    ] }, "2026-11-04");
    expect(offers.map((o) => [o.company, o.publishedAt])).toEqual([["Acme", "2026-11-01"], ["Beta", "2026-11-04"]]);
    const p = prospectFromDiscovery(groupByCompany(offers)[0], null, "2026-11-04", "web");
    expect(p.signal).toBe("1 offre commerciale publiée (dernière : SDR)");
    expect(p.origin).toBe("web");
  });
  it("change de thème chaque jour et exclut les entreprises connues", () => {
    expect(new Set(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map(themeOf)).size).toBe(WEB_THEMES.length);
    const prompt = webDiscoveryPrompt("2026-11-04", 10, ["Connue SA"]);
    expect(prompt).toContain("Ignore ces entreprises déjà connues : Connue SA");
    expect(prompt).toContain("Ne lis pas les pages");
  });
});

describe("détection par le registre", () => {
  it("départements imposés, sinon 3 départements qui changent chaque jour", () => {
    expect(departementsOf("2026-11-05", ["59", " 62", "99"])).toEqual(["59", "62"]);
    const a = departementsOf("2026-11-05", []), b = departementsOf("2026-11-06", []);
    expect(a).toHaveLength(3);
    expect(a).not.toEqual(b);
  });
  it("chaque pôle a ses activités et ses tailles ; fiche sourcée par le registre", () => {
    expect(REGISTRY_TARGETS.swipsales.naf).toContain("78.10Z"); // cabinets de recrutement
    expect(REGISTRY_TARGETS.northreef.tranches).toContain("01"); // TPE et artisans
    const f = parseFirms({ results: [firmRow()] })[0];
    expect(prospectFromFirm(f, "amandis", "2026-11-05")).toMatchObject({ company: "Acme Solutions", origin: "registre_amandis", assignedBy: "orchestrateur", decisionName: "Claire Martin", source: "https://annuaire-entreprises.data.gouv.fr/entreprise/123456789" });
    expect(prospectFromFirm(f, "swipsales", "2026-11-05").assignedBy).toBe("legacy");
  });
});
