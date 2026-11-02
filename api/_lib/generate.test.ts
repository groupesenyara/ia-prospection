import { describe, expect, it, vi } from "vitest";
import { generate, type GenerateDeps } from "./generate";

const deps = (o: Partial<GenerateDeps> = {}): GenerateDeps => ({
  enabled: true, dailyLimit: 2,
  usageToday: async () => 0,
  logUsage: vi.fn(async () => {}),
  getProspect: async (id) => ({ id, company: "Acme", optOut: false, commsConsent: true, roles: "SDR", size: "Inconnue", source: "x" } as never),
  getSettings: async () => ({ facts: ["Plateforme réservée aux commerciaux"], signature: "Yannis" }),
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
    expect(await generate({ kind: "outreach", prospectId: "p" }, d)).toEqual({ text: "ok" });
    const prompt = (d.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("N'invente aucun chiffre");
    expect(prompt).toContain("Plateforme réservée aux commerciaux");
    expect(d.logUsage).toHaveBeenCalledWith("outreach", 10, 5);
  });
});
