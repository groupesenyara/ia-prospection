// SwipSales Growth — reprise de l'historique Stripe (LECTURE SEULE côté Stripe).
// Remplit growth_stripe_subscriptions avec tous les abonnements existants et leur première facture payée.
// Usage : npx tsx scripts/growth-backfill-stripe.ts            (simulation : affiche, n'écrit rien)
//         npx tsx scripts/growth-backfill-stripe.ts --write    (écrit dans Supabase)
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { subscriptionRow } from "../lib/growth/core";

const write = process.argv.includes("--write");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const list = (v?: string) => (v || "").split(",").map(s => s.trim()).filter(Boolean);
const opts = { recruiterPriceIds: list(process.env.GROWTH_RECRUITER_PRICE_IDS), candidatePriceIds: list(process.env.GROWTH_CANDIDATE_PRICE_IDS) };
const supabase = write ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) : null;

async function firstPaidAt(subId: string): Promise<string | null> {
  let first: number | null = null;
  for await (const inv of stripe.invoices.list({ subscription: subId, status: "paid", limit: 100 })) {
    const t = inv.status_transitions?.paid_at;
    if (t && inv.amount_paid > 0 && (first === null || t < first)) first = t;
  }
  return first ? new Date(first * 1000).toISOString() : null;
}

async function main() {
  let n = 0, paying = 0, mrr = 0;
  for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100, expand: ["data.items.data.price.product"] })) {
    const row = subscriptionRow(sub, opts);
    const paidAt = await firstPaidAt(sub.id);
    n++;
    if (row.livemode && paidAt && row.status === "active") { paying++; mrr += row.monthly_cents; }
    console.log(`${sub.id}\t${row.audience}\t${row.status}\t${(row.monthly_cents / 100).toFixed(2)} €/mois\tpayé depuis ${paidAt ?? "—"}`);
    if (supabase) {
      const { error } = await supabase.from("growth_stripe_subscriptions").upsert({ ...row, first_paid_at: paidAt, updated_at: new Date().toISOString() }, { onConflict: "subscription_id" });
      if (error) throw error;
    }
  }
  console.log(`\n${n} abonnements lus. Payants actifs (live) : ${paying}. MRR : ${(mrr / 100).toFixed(2)} € HT.${write ? "" : "\nSimulation : rien n'a été écrit. Relancez avec --write."}`);
}
main().catch(e => { console.error(e); process.exit(1); });
