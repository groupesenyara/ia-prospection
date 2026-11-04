// POST /api/research — depuis l'interface, pour un membre de l'équipe (owner ou editor).
//   { prospectId } : recherche web sur une fiche (compte dans le plafond quotidien).
//   { run: true }  : lance tout de suite la détection + les recherches du jour (owner uniquement).
import { aiReady, liveDeps } from "./_lib/deps.js";
import { enrichOne } from "./_lib/prospecting.js";
import { adminClient, json, teamUser } from "./_lib/server.js";
import { runProspecting } from "./cron/prospect.js";

export async function POST(req: Request): Promise<Response> {
  const db = adminClient();
  const user = await teamUser(req, db);
  if (!user || user.role === "viewer") return json(403, { error: "Réservé aux membres de l’équipe" });
  let body: { prospectId?: string; run?: boolean };
  try { body = (await req.json()) as typeof body; } catch { return json(400, { error: "JSON invalide" }); }
  if (body.run) {
    if (user.role !== "owner") return json(403, { error: "Seul Yannis lance l’agent" });
    return json(200, await runProspecting());
  }
  if (!aiReady()) return json(503, { error: "Recherche IA désactivée (AI_ENABLED / ANTHROPIC_API_KEY)" });
  const d = liveDeps(db);
  if ((await d.store.researchUsedToday()) >= d.dailyLimit) return json(429, { error: `Plafond de ${d.dailyLimit} recherches par jour atteint` });
  const p = body.prospectId ? await d.store.get(String(body.prospectId)) : null;
  if (!p) return json(404, { error: "Entreprise introuvable" });
  if (p.optOut) return json(409, { error: "Entreprise en opposition : pas de recherche" });
  try {
    const ok = await enrichOne(d, p);
    return ok ? json(200, { ok: true }) : json(502, { error: "La recherche n’a pas abouti, voir la fiche" });
  } catch (e) {
    console.error("[research]", e);
    return json(500, { error: "Erreur pendant la recherche" });
  }
}
