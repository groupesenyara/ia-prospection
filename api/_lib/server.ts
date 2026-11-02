// Outils serveur partagés par les fonctions Vercel. La clé service role ne quitte jamais le serveur.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  if (!admin) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis");
    admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/** Vérifie le jeton Supabase envoyé par le front et renvoie l'utilisateur et son rôle dans l'équipe. */
export async function teamUser(req: Request, db: SupabaseClient): Promise<{ id: string; role: string } | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: m } = await db.from("team_members").select("role").eq("user_id", data.user.id).maybeSingle();
  return m ? { id: data.user.id, role: m.role as string } : null;
}
