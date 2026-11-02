// POST /api/ai/generate — rédaction d'un message ou d'une publication par Claude, pour un membre de l'équipe.
import Anthropic from "@anthropic-ai/sdk";
import { prospectFromRow } from "../../src/lib/mapping.js";
import { generate, HttpError, type GenerateRequest } from "../_lib/generate.js";
import { adminClient, json, teamUser } from "../_lib/server.js";

export async function POST(req: Request): Promise<Response> {
  const db = adminClient();
  const user = await teamUser(req, db);
  if (!user || user.role === "viewer") return json(403, { error: "Réservé aux membres de l’équipe" });
  let body: GenerateRequest;
  try { body = (await req.json()) as GenerateRequest; } catch { return json(400, { error: "JSON invalide" }); }
  const day = new Date().toISOString().slice(0, 10);
  try {
    const out = await generate(body, {
      enabled: process.env.AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY,
      dailyLimit: Number(process.env.AI_DAILY_LIMIT || 50),
      async usageToday() {
        const { count } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("day", day);
        return count || 0;
      },
      async logUsage(kind, tokensIn, tokensOut) {
        await db.from("ai_usage").insert({ day, user_id: user.id, kind, tokens_in: tokensIn, tokens_out: tokensOut });
      },
      async getProspect(id) {
        const { data } = await db.from("prospects").select("*").eq("id", id).maybeSingle();
        return data ? prospectFromRow(data) : null;
      },
      async getSettings() {
        const { data } = await db.from("settings").select("value").eq("key", "product").maybeSingle();
        const v = (data?.value || {}) as { facts?: { text: string; status: string }[]; sender?: string; signature?: string };
        return { facts: (v.facts || []).filter((f) => f.status === "Confirmé").map((f) => f.text), signature: [v.sender, v.signature].filter(Boolean).join(", ") };
      },
      async complete(prompt) {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const msg = await client.messages.create({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 1500, messages: [{ role: "user", content: prompt }] });
        const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        return { text, tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens };
      },
    });
    return json(200, out);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error("[ai/generate]", e);
    return json(500, { error: "Erreur de rédaction" });
  }
}
