// SwipSales Growth — endpoint webhook Stripe DÉDIÉ au suivi (n'interfère pas avec le webhook de paiement existant).
// À déclarer dans Stripe > Développeurs > Webhooks avec les événements listés dans LISEZ-MOI.md.
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { handleStripeEvent, type WebhookDeps } from "@/lib/growth/webhook";

export const runtime = "nodejs";          // corps brut nécessaire à la vérification de signature
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const list = (v?: string) => (v || "").split(",").map(s => s.trim()).filter(Boolean);

const deps: WebhookDeps = {
  retrieveSubscription: id => stripe.subscriptions.retrieve(id, { expand: ["items.data.price.product"] }),
  async upsertSubscription(row) {
    const { error } = await supabase.from("growth_stripe_subscriptions").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "subscription_id" });
    if (error) throw error;
  },
  async markFirstPaid(id, at) {
    const { error } = await supabase.from("growth_stripe_subscriptions").update({ first_paid_at: at }).eq("subscription_id", id).is("first_paid_at", null);
    if (error) throw error;
  },
  async getSubscription(id) {
    const { data, error } = await supabase.from("growth_stripe_subscriptions").select("first_paid_at,user_id,audience").eq("subscription_id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async insertEvent(e) {
    const { error } = await supabase.from("growth_events").insert(e);
    if (error?.code === "23505") return "duplicate";   // stripe_event_id déjà enregistré
    if (error) throw error;
    return "inserted";
  },
  recruiterPriceIds: list(process.env.GROWTH_RECRUITER_PRICE_IDS),
  candidatePriceIds: list(process.env.GROWTH_CANDIDATE_PRICE_IDS),
};

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_GROWTH_WEBHOOK_SECRET;
  if (!sig || !secret) return new Response("Signature manquante", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), sig, secret);
  } catch {
    return new Response("Signature invalide", { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event, deps);
    return Response.json(result);
  } catch (err) {
    console.error("[growth-webhook]", event.type, event.id, err);
    return new Response("Erreur de traitement", { status: 500 }); // Stripe réessaiera
  }
}
