// SwipSales Growth — traitement des événements Stripe, indépendant de Next.js et de Supabase (injectés).
import type Stripe from "stripe";
import { eventFromPaidInvoice, invoiceSubscriptionId, subscriptionRow, type SubscriptionRow } from "./core";

export interface GrowthEventInsert {
  event: string;
  user_id: string | null;
  role: "recruteur" | "candidat" | null;
  properties: Record<string, unknown>;
  source: "stripe";
  stripe_event_id: string;
  occurred_at: string;
}

export interface WebhookDeps {
  /** Lit l'état actuel de l'abonnement chez Stripe (évite les problèmes d'ordre d'arrivée). */
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  /** Insère ou met à jour la ligne d'abonnement, sans jamais toucher first_paid_at. */
  upsertSubscription(row: SubscriptionRow): Promise<void>;
  /** Pose first_paid_at seulement s'il est encore vide. */
  markFirstPaid(subscriptionId: string, paidAtIso: string): Promise<void>;
  /** Lit la ligne enregistrée (pour savoir si l'abonnement a déjà été payé). */
  getSubscription(subscriptionId: string): Promise<{ first_paid_at: string | null; user_id: string | null; audience: string } | null>;
  /** Insère un événement ; un stripe_event_id déjà vu est ignoré (idempotence). */
  insertEvent(e: GrowthEventInsert): Promise<"inserted" | "duplicate">;
  recruiterPriceIds?: string[];
  candidatePriceIds?: string[];
}

const roleOf = (a?: string | null) => (a === "recruteur" || a === "candidat" ? a : null);
const iso = (s: number) => new Date(s * 1000).toISOString();

export type HandleResult = { handled: boolean; action: string };

export async function handleStripeEvent(evt: Stripe.Event, deps: WebhookDeps): Promise<HandleResult> {
  const opts = { recruiterPriceIds: deps.recruiterPriceIds, candidatePriceIds: deps.candidatePriceIds };

  const syncSub = async (id: string) => {
    const fresh = await deps.retrieveSubscription(id);
    const row = subscriptionRow(fresh, opts);
    await deps.upsertSubscription(row);
    return row;
  };

  switch (evt.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = evt.data.object as Stripe.Subscription;
      await syncSub(sub.id);
      return { handled: true, action: "subscription_synced" };
    }
    case "customer.subscription.deleted": {
      const sub = evt.data.object as Stripe.Subscription;
      const before = await deps.getSubscription(sub.id);
      const row = subscriptionRow(sub, opts); // l'abonnement supprimé n'est plus modifiable : l'objet de l'événement fait foi
      await deps.upsertSubscription(row);
      if (before?.first_paid_at) {
        const r = await deps.insertEvent({
          event: "subscription_canceled", user_id: row.user_id, role: roleOf(row.audience), source: "stripe",
          stripe_event_id: evt.id, occurred_at: row.ended_at ?? iso(evt.created),
          properties: { subscription_id: sub.id, monthly_cents: row.monthly_cents, cancellation_reason: (sub as any).cancellation_details?.reason ?? null },
        });
        return { handled: true, action: r === "inserted" ? "canceled_recorded" : "duplicate" };
      }
      return { handled: true, action: "canceled_unpaid_ignored" };
    }
    case "invoice.paid": {
      const inv = evt.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(inv);
      const kind = eventFromPaidInvoice(inv);
      if (!subId || !kind) return { handled: false, action: "invoice_ignored" };
      const row = await syncSub(subId);
      const paidAt = inv.status_transitions?.paid_at ? iso(inv.status_transitions.paid_at) : iso(evt.created);
      await deps.markFirstPaid(subId, paidAt);
      const r = await deps.insertEvent({
        event: kind, user_id: row.user_id, role: roleOf(row.audience), source: "stripe", stripe_event_id: evt.id, occurred_at: paidAt,
        properties: { subscription_id: subId, invoice_id: inv.id, amount_paid_cents: inv.amount_paid, currency: inv.currency, livemode: inv.livemode },
      });
      return { handled: true, action: r === "inserted" ? kind : "duplicate" };
    }
    case "invoice.payment_failed": {
      const inv = evt.data.object as Stripe.Invoice;
      const subId = invoiceSubscriptionId(inv);
      if (!subId) return { handled: false, action: "invoice_ignored" };
      const known = await deps.getSubscription(subId);
      const r = await deps.insertEvent({
        event: "payment_failed", user_id: known?.user_id ?? null, role: roleOf(known?.audience), source: "stripe", stripe_event_id: evt.id, occurred_at: iso(evt.created),
        properties: { subscription_id: subId, invoice_id: inv.id, amount_due_cents: inv.amount_due, attempt_count: inv.attempt_count },
      });
      return { handled: true, action: r === "inserted" ? "payment_failed" : "duplicate" };
    }
    case "checkout.session.completed": {
      const s = evt.data.object as Stripe.Checkout.Session;
      const userId = s.client_reference_id && /^[0-9a-f-]{36}$/i.test(s.client_reference_id) ? s.client_reference_id : null;
      const r = await deps.insertEvent({
        event: "checkout_completed", user_id: userId, role: roleOf(s.metadata?.audience), source: "stripe", stripe_event_id: evt.id, occurred_at: iso(evt.created),
        // Retour du Checkout : intention d'achat, PAS une preuve de paiement (voir invoice.paid).
        properties: { session_id: s.id, mode: s.mode, payment_status: s.payment_status, subscription_id: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null },
      });
      return { handled: true, action: r === "inserted" ? "checkout_completed" : "duplicate" };
    }
    default:
      return { handled: false, action: "ignored" };
  }
}
