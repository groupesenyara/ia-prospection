# SwipSales Growth : pack de suivi des inscriptions et des paiements

Pour : Guillaume
Préparé le 19/10/2026

## Objectif

Mesurer sans approximation, dans Supabase :
- les inscriptions et l'activation (profil complété, test ADN, swipe, match…) ;
- les clients payants, le MRR, les renouvellements et les résiliations, à partir de Stripe.

Un client n'est compté « payant » que lorsqu'une facture d'abonnement de plus de 0 € est **payée dans Stripe**. Ni le retour de Checkout ni la page de confirmation ne suffisent.

Le pack est **additif** :
- il crée deux tables et trois vues préfixées `growth_` ;
- il ajoute un endpoint webhook **séparé** de celui qui gère les paiements aujourd'hui.

Il ne modifie ni le parcours de paiement, ni les prix, ni les tables existantes.

## Contenu

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20261019120000_growth_tracking.sql` | Tables `growth_events` et `growth_stripe_subscriptions`, vues `growth_v_mrr_now`, `growth_v_monthly`, `growth_v_paying_subscriptions`. RLS activée sans policy, droits retirés à `anon` et `authenticated`. |
| `lib/growth/core.ts` | Fonctions pures : mensualisation (annuel ÷ 12, remise %), audience recruteur/candidat, lecture des factures (ancienne et nouvelle API Stripe). |
| `lib/growth/webhook.ts` | Traitement des événements Stripe : idempotent, et relit l'abonnement chez Stripe pour ne pas dépendre de l'ordre d'arrivée. |
| `app/api/growth/stripe-webhook/route.ts` | Endpoint Next.js (App Router, runtime Node) avec vérification de signature. |
| `lib/growth/track.ts` | `trackEvent()` pour les événements produit, côté serveur uniquement. |
| `scripts/growth-backfill-stripe.ts` | Reprise de l'historique Stripe, en lecture seule côté Stripe. Mode simulation par défaut. |
| `tests/growth.test.ts` | 7 tests (voir plus bas). |

## Variables d'environnement

| Variable | Où la trouver | Remarque |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe > Développeurs > Clés | Probablement déjà présente. Une clé restreinte en lecture (Subscriptions, Invoices, Prices, Products) suffit. |
| `STRIPE_GROWTH_WEBHOOK_SECRET` | Stripe > Webhooks > nouvel endpoint > « Signing secret » (`whsec_…`) | **Distincte** du secret du webhook de paiement existant. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API | Déjà présente. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API | Serveur uniquement : jamais dans un composant client ni dans une variable `NEXT_PUBLIC_`. |
| `GROWTH_RECRUITER_PRICE_IDS` | Liste `price_…` séparés par des virgules | Facultatif si les prix portent la métadonnée `audience` (voir étape 3). |
| `GROWTH_CANDIDATE_PRICE_IDS` | Idem pour les offres Carrière | Facultatif dans le même cas. |

À ajouter dans Vercel (Production et Preview) et dans `.env.local`.

## Installation : à faire d'abord en mode test Stripe

1. **Migration**
   - Commande : `supabase db push`, ou coller le fichier SQL dans l'éditeur SQL Supabase.
   - La migration ne touche aucune table existante.
2. **Fichiers**
   - Copier `lib/growth/*` et `app/api/growth/stripe-webhook/route.ts`.
   - Si l'alias `@/` n'existe pas, remplacer l'import par un chemin relatif.
   - Si le paquet `server-only` est absent : `npm i server-only`.
3. **Audience des prix**
   - Dans Stripe, sur chaque prix, ajouter la métadonnée `audience` :
     - `recruteur` pour Entrepreneur, Starter et Pro ;
     - `candidat` pour Carrière et Carrière Coaching.
   - Les variables `GROWTH_*_PRICE_IDS` peuvent servir à la place.
   - Sans l'un ou l'autre, le MRR est classé « inconnu ».
4. **Lien abonnement → utilisateur**
   - Au moment de créer la session Checkout, passer :
     - `client_reference_id: user.id` ;
     - `subscription_data: { metadata: { user_id: user.id } }`.
   - C'est la seule modification du code de paiement, et elle n'est pas obligatoire.
   - Sans elle, les montants restent justes, mais un abonnement ne peut pas être relié à un compte.
5. **Endpoint Stripe**
   - URL : `https://swipsales.fr/api/growth/stripe-webhook`.
   - Événements à cocher :
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `checkout.session.completed`
6. **Test local**
   - `stripe listen --forward-to localhost:3000/api/growth/stripe-webhook`
   - Puis souscrire un abonnement avec la carte test `4242 4242 4242 4242`.
   - Vérifier dans `growth_stripe_subscriptions` que `first_paid_at` se remplit après `invoice.paid`, et pas avant.
7. **Historique**
   - Simulation : `npx tsx scripts/growth-backfill-stripe.ts`. Elle affiche les abonnements et le MRR sans rien écrire.
   - Écriture : relancer avec `--write`.
8. **Production** : refaire l'étape 5 en mode live, **après accord de Yannis**.

## Événements produit à brancher

Appeler `trackEvent()` côté serveur, une fois l'action réussie :

| Événement | Où l'appeler | `role` | `properties` utiles |
|---|---|---|---|
| `signup_completed` | Après création du compte | recruteur / candidat | `source` (utm, code école, affilié) |
| `profile_completed` | Quand les champs obligatoires du profil ou de la fiche entreprise sont remplis, une seule fois | les deux | — |
| `adn_test_completed` | Fin des 48 situations | candidat | `profil` (chasseur/éleveur) |
| `job_published` | Offre publiée | recruteur | `plan` |
| `search_performed` | Filtre ou recherche appliqués | recruteur | `filtres` (noms, pas de valeurs personnelles) |
| `profile_viewed` | Ouverture d'un profil candidat | recruteur | — |
| `swipe` | Chaque swipe | les deux | `direction` |
| `match_created` | Match réciproque | — | `offer_id` |
| `application_sent` | Candidature envoyée | candidat | `offer_id` |
| `message_sent` | Premier message d'une conversation | les deux | — |
| `checkout_started` | Avant la redirection vers Stripe Checkout | les deux | `price_id` |

**RGPD**
- Ne mettre dans `properties` ni e-mail, ni nom, ni CV, ni texte libre : des identifiants techniques suffisent.
- Les tables ne sont lisibles que par la clé service role.

## Lire les chiffres

```sql
-- MRR actuel par audience (clients live, première facture payée, statut active)
select * from growth_v_mrr_now;

-- Relevé mensuel : ces colonnes correspondent au formulaire « Saisir un relevé » de l'agent
select * from growth_v_monthly order by month_start desc limit 3;
```

Ces vues fournissent :
- le MRR et les abonnés actifs ;
- les nouveaux payants et les résiliations ;
- les actifs en début de mois ;
- les inscriptions recruteurs et candidats ;
- les profils complétés.

Elles ne fournissent pas, et il faut les prendre ailleurs :
- le nombre de visiteurs (outil d'analytics) ;
- le MRR perdu par baisse de plan.

## Ce qui a été testé

Tests exécutés le 19/10/2026 avec `npx tsx --test tests/growth.test.ts`. Pour les relancer dans le dépôt, installer d'abord `npm i -D tsx @electric-sql/pglite`. Résultat : **7/7 réussis**.

- **Mensualisation** : mensuel, annuel (852 €/an donne 71 €/mois), remise en %, intervalle inconnu.
- **Ligne d'abonnement** : audience lue par métadonnée ou par liste d'IDs ; un `user_id` qui n'est pas un UUID est rejeté.
- **Factures** :
  - création → `payment_succeeded` ;
  - cycle → `subscription_renewed` ;
  - facture à 0 € ignorée ;
  - format de l'API Stripe « basil » pris en charge (`parent.subscription_details`).
- **Parcours complet** :
  - un abonnement créé n'est pas payant ;
  - le retour Checkout n'est pas payant ;
  - `invoice.paid` est payant ;
  - un événement rejoué ne crée pas de doublon ;
  - le renouvellement ne change pas `first_paid_at` ;
  - la résiliation d'un abonné payant est enregistrée.
- **Résiliation sans paiement** : non comptée comme churn.
- **Signature Stripe** : la signature valide est acceptée, un corps modifié est refusé.
- **SQL sur Postgres (PGlite)** :
  - la migration s'applique ;
  - MRR par audience ;
  - les abonnements test et non payés sont exclus ;
  - indicateurs mensuels corrects ;
  - le rôle `anon` est refusé sur les tables et les vues ;
  - la contrainte sur le nom d'événement fonctionne ;
  - l'unicité de `stripe_event_id` fonctionne.

## Ce qui n'a PAS été testé

Le dépôt SwipSales n'était pas accessible. Restent donc à vérifier :
- l'intégration dans le dépôt réel : chemins, alias `@/`, version de Next.js, client Supabase existant ;
- le comportement sur le projet Supabase réel : droits par défaut, version de Postgres ;
- les appels réels à l'API Stripe : `subscriptions.retrieve`, `invoices.list`, version d'API du compte ;
- les abonnements à plusieurs articles (seul le premier est lu) et les remises en montant fixe, qui sont ignorées.

## Retour vers l'agent SwipSales Growth

Deux options :
- connecter Supabase (lecture) à Claude, pour que l'agent lise directement `growth_v_monthly` ;
- ou recopier chaque mois la ligne de `growth_v_monthly` dans **Mesures > Saisir un relevé**, en indiquant la source.
