// SwipSales Growth — fonctions pures (sans réseau), testées dans tests/core.test.ts
import type Stripe from "stripe";

export type Audience = "recruteur" | "candidat" | "inconnu";

export interface SubscriptionRow {
  subscription_id: string;
  customer_id: string;
  user_id: string | null;
  audience: Audience;
  status: string;
  price_id: string | null;
  plan_interval: string | null;
  interval_count: number;
  unit_amount_cents: number;
  quantity: number;
  discount_percent: number;
  monthly_cents: number;
  livemode: boolean;
  started_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
}

const iso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);

/** Montant mensualisé HT en centimes : annuel ÷ 12, hebdomadaire × 52/12, remise en % déduite. */
export function monthlyCents(
  unitAmountCents: number,
  quantity: number,
  interval: string | null,
  intervalCount = 1,
  discountPercent = 0,
): number {
  const gross = unitAmountCents * quantity * (1 - discountPercent / 100);
  const months =
    interval === "month" ? intervalCount :
    interval === "year" ? 12 * intervalCount :
    interval === "week" ? (12 / 52) * intervalCount :
    interval === "day" ? (12 / 365) * intervalCount : NaN;
  if (!Number.isFinite(months) || months <= 0) return 0;
  return Math.round(gross / months);
}

/** Lit l'audience dans les métadonnées du prix, puis du produit (clé « audience »), sinon via la liste d'IDs de prix. */
export function audienceOf(price: Stripe.Price | null | undefined, recruiterPriceIds: string[] = [], candidatePriceIds: string[] = []): Audience {
  if (!price) return "inconnu";
  const meta = (price.metadata?.audience || (typeof price.product === "object" && price.product && !("deleted" in price.product && price.product.deleted) ? (price.product as Stripe.Product).metadata?.audience : "") || "").toLowerCase();
  if (meta === "recruteur" || meta === "candidat") return meta;
  if (recruiterPriceIds.includes(price.id)) return "recruteur";
  if (candidatePriceIds.includes(price.id)) return "candidat";
  return "inconnu";
}

/** Convertit un abonnement Stripe en ligne de growth.stripe_subscriptions (premier article seulement). */
export function subscriptionRow(sub: Stripe.Subscription, opts: { recruiterPriceIds?: string[]; candidatePriceIds?: string[] } = {}): SubscriptionRow {
  const item = sub.items?.data?.[0];
  const price = item?.price ?? null;
  const anySub = sub as any;
  const firstDiscount = Array.isArray(anySub.discounts) ? anySub.discounts.find((d: any) => typeof d === "object") : null;
  const pct = anySub.discount?.coupon?.percent_off ?? firstDiscount?.coupon?.percent_off ?? 0;
  const userId = sub.metadata?.user_id || sub.metadata?.supabase_user_id || null;
  return {
    subscription_id: sub.id,
    customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    user_id: userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null,
    audience: audienceOf(price, opts.recruiterPriceIds, opts.candidatePriceIds),
    status: sub.status,
    price_id: price?.id ?? null,
    plan_interval: price?.recurring?.interval ?? null,
    interval_count: price?.recurring?.interval_count ?? 1,
    unit_amount_cents: price?.unit_amount ?? 0,
    quantity: item?.quantity ?? 1,
    discount_percent: pct,
    monthly_cents: monthlyCents(price?.unit_amount ?? 0, item?.quantity ?? 1, price?.recurring?.interval ?? null, price?.recurring?.interval_count ?? 1, pct),
    livemode: sub.livemode,
    started_at: iso(sub.start_date),
    canceled_at: iso(sub.canceled_at),
    ended_at: iso(sub.ended_at),
  };
}

/** Une facture payée devient « payment_succeeded » (création) ou « subscription_renewed » (cycle). 0 € ignoré. */
export function invoiceSubscriptionId(inv: Stripe.Invoice): string | null {
  const a = inv as any;
  const s = a.subscription ?? a.parent?.subscription_details?.subscription ?? null; // API < 2025-03 / API « basil » et suivantes
  return s ? (typeof s === "string" ? s : s.id) : null;
}

export function eventFromPaidInvoice(inv: Stripe.Invoice): "payment_succeeded" | "subscription_renewed" | null {
  if (!invoiceSubscriptionId(inv) || inv.status !== "paid" || (inv.amount_paid ?? 0) <= 0) return null;
  if (inv.billing_reason === "subscription_create") return "payment_succeeded";
  if (inv.billing_reason === "subscription_cycle") return "subscription_renewed";
  return null;
}
