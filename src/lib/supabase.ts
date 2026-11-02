import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = !!url && !!key;
export const supabase = createClient(url || "http://localhost", key || "public-anon-key");

/** Appel d'une fonction serveur avec le jeton de session. */
export async function api<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `Erreur ${r.status}`);
  return out as T;
}
