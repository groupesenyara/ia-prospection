import { describe, expect, it, vi } from "vitest";
import { generate, type GenerateDeps } from "./generate.js";

const deps = (o: Partial<GenerateDeps> = {}): GenerateDeps => ({
  enabled: true, dailyLimit: 2,
  usageToday: async () => 0,
  logUsage: vi.fn(async () => {}),
  getProspect: async (id) => ({ id, company: "Acme", optOut: false, commsConsent: true, roles: "SDR", size: "Inconnue", source: "x" } as never),
  getFacts: async () => ({
    swipsales: [{ kind: "offre", text: "Plateforme réservée aux commerciaux" }],
    amandis: [{ kind: "offre", text: "Formation prospection / vente B2B" }, { kind: "interdit", text: "Amandis School n'est PAS certifiée Qualiopi" }],
  }),
  complete: vi.fn(async () => ({ text: "ok", tokensIn: 10, tokensOut: 5 })),
  ...o,
});

describe("rédaction IA", () => {
  it("désactivée par défaut, plafonnée par jour", async () => {
    await expect(generate({ kind: "outreach", prospectId: "p" }, deps({ enabled: false }))).rejects.toThrow(/désactivée/);
    await expect(generate({ kind: "outreach", prospectId: "p" }, deps({ usageToday: async () => 2 }))).rejects.toThrow(/Plafond/);
  });
  it("refuse une entreprise en opposition ou citée sans accord", async () => {
    await expect(generate({ kind: "outreach", prospectId: "p" }, deps({ getProspect: async () => ({ optOut: true } as never) }))).rejects.toThrow(/opposition/);
    await expect(generate({ kind: "content", title: "t", why: "w", prospectId: "p" }, deps({ getProspect: async () => ({ commsConsent: false } as never) }))).rejects.toThrow(/accord/);
  });
  it("construit le prompt côté serveur avec les règles et journalise l'usage", async () => {
    const d = deps();
    expect(await generate({ kind: "outreach", prospectId: "p" }, d)).toEqual({ text: "ok", unit: "swipsales", issues: [] });
    const prompt = (d.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("N'invente aucun chiffre");
    expect(prompt).toContain("Plateforme réservée aux commerciaux");
    expect(d.logUsage).toHaveBeenCalledWith("outreach", 10, 5);
  });

  it("rédige pour le pôle demandé (ou le pôle principal de la recherche) et bloque les affirmations non confirmées", async () => {
    const d = deps({
      getProspect: async (id) => ({ id, company: "Acme", optOut: false, roles: "SDR", size: "Inconnue", source: "x", research: { primaryUnit: "amandis" } } as never),
      complete: vi.fn(async () => ({ text: "Notre formation certifiée Qualiopi est finançable par votre OPCO.", tokensIn: 10, tokensOut: 5 })),
    });
    const r = await generate({ kind: "outreach", prospectId: "p" }, d);
    expect(r.unit).toBe("amandis");
    expect(new Set(r.issues!.map((i) => i.rule))).toEqual(new Set(["certification", "financement"]));
    const prompt = (d.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("Amandis School");
    expect(prompt).toContain("[interdit] Amandis School n'est PAS certifiée Qualiopi");
    expect(prompt).not.toContain("Plateforme réservée aux commerciaux"); // pas les faits d'un autre pôle
    await generate({ kind: "outreach", prospectId: "p", unit: "northreef" }, d);
    expect((d.complete as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain("« Groupe Senyara »");
  });
});
