// Tests du pack Growth : fonctions pures, traitement webhook (dépendances en mémoire), signature Stripe, SQL sur PGlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Stripe from "stripe";
import { PGlite } from "@electric-sql/pglite";
import { monthlyCents, subscriptionRow, eventFromPaidInvoice, invoiceSubscriptionId } from "../lib/growth/core";
import { handleStripeEvent, type WebhookDeps, type GrowthEventInsert } from "../lib/growth/webhook";

const UID = "11111111-2222-3333-4444-555555555555";
const sub = (o: any = {}): any => ({
  id: "sub_1", object: "subscription", customer: "cus_1", status: "active", livemode: true, start_date: 1760000000,
  canceled_at: null, ended_at: null, metadata: { user_id: UID }, discount: null,
  items: { data: [{ quantity: 1, price: { id: "price_pro_m", unit_amount: 39900, recurring: { interval: "month", interval_count: 1 }, metadata: { audience: "recruteur" }, product: "prod_1" } }] },
  ...o,
});

test("mensualisation : mensuel, annuel, remise, intervalle inconnu", () => {
  assert.equal(monthlyCents(8900, 1, "month"), 8900);
  assert.equal(monthlyCents(85200, 1, "year"), 7100);          // 852 € / an → 71 €/mois
  assert.equal(monthlyCents(14900, 1, "month", 1, 20), 11920);
  assert.equal(monthlyCents(1000, 1, null), 0);
});

test("ligne d'abonnement : audience, user_id valide, montant", () => {
  const r = subscriptionRow(sub());
  assert.equal(r.audience, "recruteur");
  assert.equal(r.user_id, UID);
  assert.equal(r.monthly_cents, 39900);
  const r2 = subscriptionRow(sub({ metadata: { user_id: "pas-un-uuid" } }), { candidatePriceIds: ["price_pro_m"] });
  assert.equal(r2.user_id, null);
  const r3 = subscriptionRow(sub({ items: { data: [{ quantity: 1, price: { id: "price_x", unit_amount: 1900, recurring: { interval: "month" }, metadata: {} } }] } }), { candidatePriceIds: ["price_x"] });
  assert.equal(r3.audience, "candidat");
});

test("facture : création, renouvellement, 0 €, ancienne et nouvelle API", () => {
  assert.equal(eventFromPaidInvoice({ subscription: "sub_1", status: "paid", amount_paid: 8900, billing_reason: "subscription_create" } as any), "payment_succeeded");
  assert.equal(eventFromPaidInvoice({ subscription: "sub_1", status: "paid", amount_paid: 8900, billing_reason: "subscription_cycle" } as any), "subscription_renewed");
  assert.equal(eventFromPaidInvoice({ subscription: "sub_1", status: "paid", amount_paid: 0, billing_reason: "subscription_create" } as any), null);
  assert.equal(invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_9" } } } as any), "sub_9");
});

function memoryDeps(stripeSub: any) {
  const subs = new Map<string, any>(); const events: GrowthEventInsert[] = [];
  const deps: WebhookDeps = {
    retrieveSubscription: async () => stripeSub,
    upsertSubscription: async row => { subs.set(row.subscription_id, { ...(subs.get(row.subscription_id) || { first_paid_at: null }), ...row }); },
    markFirstPaid: async (id, at) => { const s = subs.get(id); if (s && !s.first_paid_at) s.first_paid_at = at; },
    getSubscription: async id => subs.get(id) ?? null,
    insertEvent: async e => { if (events.some(x => x.stripe_event_id === e.stripe_event_id)) return "duplicate"; events.push(e); return "inserted"; },
  };
  return { deps, subs, events };
}
const evt = (id: string, type: string, object: any, created = 1760100000): any => ({ id, type, created, data: { object } });

test("parcours : abonnement créé ≠ client payant tant que la facture n'est pas payée", async () => {
  const { deps, subs, events } = memoryDeps(sub());
  await handleStripeEvent(evt("evt_1", "customer.subscription.created", sub()), deps);
  assert.equal(subs.get("sub_1").first_paid_at, null, "pas encore payé");
  await handleStripeEvent(evt("evt_2", "checkout.session.completed", { id: "cs_1", mode: "subscription", payment_status: "paid", client_reference_id: UID, subscription: "sub_1", metadata: {} }), deps);
  assert.equal(subs.get("sub_1").first_paid_at, null, "le retour Checkout ne prouve pas le paiement");
  const inv = { id: "in_1", subscription: "sub_1", status: "paid", amount_paid: 39900, currency: "eur", billing_reason: "subscription_create", status_transitions: { paid_at: 1760100500 }, livemode: true };
  const r = await handleStripeEvent(evt("evt_3", "invoice.paid", inv), deps);
  assert.equal(r.action, "payment_succeeded");
  assert.equal(subs.get("sub_1").first_paid_at, new Date(1760100500 * 1000).toISOString());
  // rejeu du même événement : pas de doublon
  const again = await handleStripeEvent(evt("evt_3", "invoice.paid", inv), deps);
  assert.equal(again.action, "duplicate");
  assert.equal(events.filter(e => e.event === "payment_succeeded").length, 1);
  // renouvellement : first_paid_at inchangé
  await handleStripeEvent(evt("evt_4", "invoice.paid", { ...inv, id: "in_2", billing_reason: "subscription_cycle", status_transitions: { paid_at: 1762800000 } }), deps);
  assert.equal(subs.get("sub_1").first_paid_at, new Date(1760100500 * 1000).toISOString());
  assert.equal(events.filter(e => e.event === "subscription_renewed").length, 1);
  // résiliation d'un abonné payant → événement
  const ended = sub({ status: "canceled", ended_at: 1765000000, canceled_at: 1764000000 });
  const c = await handleStripeEvent(evt("evt_5", "customer.subscription.deleted", ended), deps);
  assert.equal(c.action, "canceled_recorded");
  assert.equal(subs.get("sub_1").status, "canceled");
});

test("résiliation d'un abonnement jamais payé : pas comptée comme churn", async () => {
  const { deps, events } = memoryDeps(sub());
  await handleStripeEvent(evt("evt_a", "customer.subscription.created", sub({ status: "incomplete" })), deps);
  const r = await handleStripeEvent(evt("evt_b", "customer.subscription.deleted", sub({ status: "canceled", ended_at: 1760200000 })), deps);
  assert.equal(r.action, "canceled_unpaid_ignored");
  assert.equal(events.length, 0);
});

test("signature Stripe : valide acceptée, falsifiée refusée", () => {
  const stripe = new Stripe("sk_test_dummy");
  const secret = "whsec_test_secret";
  const payload = JSON.stringify(evt("evt_sig", "invoice.paid", { id: "in_x" }));
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(stripe.webhooks.constructEvent(payload, header, secret).id, "evt_sig");
  assert.throws(() => stripe.webhooks.constructEvent(payload.replace("in_x", "in_y"), header, secret));
});

test("SQL : migration, droits et vues sur Postgres (PGlite)", async () => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated;");
  await db.exec(fs.readFileSync(new URL("../supabase/migrations/20261019120000_growth_tracking.sql", import.meta.url), "utf8"));
  await db.exec(`
    insert into growth_events (event, role, occurred_at) values
      ('signup_completed','recruteur','2026-09-03'),('signup_completed','recruteur','2026-10-02'),('signup_completed','recruteur','2026-10-05'),
      ('signup_completed','candidat','2026-10-06'),('signup_completed','candidat','2026-10-07'),('profile_completed','candidat','2026-10-08');
    insert into growth_stripe_subscriptions (subscription_id, customer_id, audience, status, monthly_cents, livemode, first_paid_at, ended_at) values
      ('sub_a','c1','recruteur','active',8900,true,'2026-09-10',null),
      ('sub_b','c2','recruteur','active',7100,true,'2026-10-04',null),
      ('sub_c','c3','recruteur','canceled',14900,true,'2026-09-12','2026-10-12'),
      ('sub_d','c4','recruteur','active',39900,true,null,null),
      ('sub_e','c5','candidat','active',1900,true,'2026-10-09',null),
      ('sub_t','c6','recruteur','active',99900,false,'2026-10-01',null);`);
  const mrr = (await db.query<any>("select audience, paying_subscriptions::int as n, mrr_eur::float as mrr from growth_v_mrr_now order by audience")).rows;
  assert.deepEqual(mrr, [{ audience: "candidat", n: 1, mrr: 19 }, { audience: "recruteur", n: 2, mrr: 160 }]);
  const oct = (await db.query<any>("select * from growth_v_monthly where month_start = '2026-10-01'")).rows[0];
  assert.equal(Number(oct.signups_recruteurs), 2);
  assert.equal(Number(oct.signups_candidats), 2);
  assert.equal(Number(oct.profils_candidats_completes), 1);
  assert.equal(Number(oct.nouveaux_payants), 2);            // sub_b + sub_e (sub_d jamais payé, sub_t en test)
  assert.equal(Number(oct.nouveaux_payants_recruteurs), 1);
  assert.equal(Number(oct.resiliations), 1);                // sub_c
  assert.equal(Number(oct.payants_debut_de_mois), 2);       // sub_a + sub_c
  // anon ne lit rien
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from growth_events"));
  await assert.rejects(db.query("select * from growth_v_mrr_now"));
  await db.exec("reset role");
  // contrainte d'événement
  await assert.rejects(db.query("insert into growth_events (event) values ('paiement_invente')"));
  // idempotence stripe_event_id
  await db.query("insert into growth_events (event, source, stripe_event_id) values ('payment_succeeded','stripe','evt_1')");
  await assert.rejects(db.query("insert into growth_events (event, source, stripe_event_id) values ('payment_succeeded','stripe','evt_1')"));
});
