// SwipSales Growth — enregistrement des événements produit, CÔTÉ SERVEUR uniquement
// (Server Actions, Route Handlers). N'importez jamais ce fichier dans un composant client :
// il utilise la clé service role.
import "server-only";
import { createClient } from "@supabase/supabase-js";

export type GrowthEvent =
  | "signup_completed" | "profile_completed" | "adn_test_completed" | "job_published"
  | "search_performed" | "profile_viewed" | "swipe" | "match_created"
  | "application_sent" | "message_sent" | "checkout_started";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Enregistre un événement. Ne lève jamais d'erreur : le suivi ne doit pas casser le parcours utilisateur.
 * Ne mettez dans `properties` aucune donnée personnelle (pas d'e-mail, de nom ni de CV) : des identifiants techniques suffisent.
 */
export async function trackEvent(
  event: GrowthEvent,
  ctx: { userId: string | null; role: "recruteur" | "candidat" | null; properties?: Record<string, string | number | boolean | null> },
): Promise<void> {
  try {
    const { error } = await admin.from("growth_events").insert({
      event, user_id: ctx.userId, role: ctx.role, properties: ctx.properties ?? {}, source: "app",
    });
    if (error) console.error("[trackEvent]", event, error.message);
  } catch (e) {
    console.error("[trackEvent]", event, e);
  }
}
