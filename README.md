# SwipSales Growth — agent commercial et marketing IA

Interface unique pour piloter la croissance de SwipSales. Elle couvre :

- la prospection et le CRM ;
- les partenariats ;
- le programme Founding Recruiters ;
- les campagnes, avec leur validation ;
- la communication ;
- les performances.

L'agent prépare et suit. **Yannis valide** : campagnes, envois, conventions et publications. Ces règles sont imposées par la base, pas seulement par l'interface.

- **Stack** : React 18 + TypeScript (Vite), Supabase (Postgres, Auth, Realtime), fonctions Vercel (Node).
- **IA** : Claude via l'API Anthropic, côté serveur uniquement. **Désactivée par défaut** (`AI_ENABLED=false`), avec un plafond de rédactions par jour.

## Démarrer

```bash
npm install
cp .env.example .env.local          # renseigner Supabase
npm run dev                         # http://localhost:5173
npm test                            # 31 tests : domaine, base (PGlite), API, import
npm run build
```

### Supabase

1. Créer le projet, puis appliquer les migrations de `supabase/migrations/` dans l'ordre (`supabase db push` ou éditeur SQL). Sur le projet `ia-prospection-swipsales`, c'est déjà fait : `init`, puis `hardening`, qui active aussi le Realtime.
2. **Auth** : activer l'e-mail (lien magique) et désactiver les inscriptions publiques. Créer les comptes de l'équipe dans *Authentication > Users*.
3. Déclarer l'équipe (rôles : `owner` = Yannis, `editor`, `viewer`) :
   ```sql
   insert into public.team_members (user_id, display_name, role) values
     ('<uuid de Yannis>', 'Yannis', 'owner'),
     ('<uuid de Joseph>', 'Joseph', 'editor');
   ```
4. **Realtime** : activé par la migration `hardening` sur `prospects`, `interactions`, `campaigns`, `content` et `outbox`.
5. **Reprendre les données du prototype** : les 15 entreprises sourcées, les 3 campagnes, la fiche produit et les retours. Les fichiers JSON sont dans `exports/`, livré à part et non versionné.
   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import:artifact -- exports           # simulation
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import:artifact -- exports --write   # écriture
   ```
   Les campagnes sont réimportées **en brouillon** : Yannis les revalide.
6. **Vérifier** : coller `supabase/verify.sql` dans l'éditeur SQL. Le script ne modifie rien et affiche 10 contrôles : tables, RLS, policies, fonctions, déclencheurs, contraintes, droits `anon`, équipe, Realtime. Chaque ligne doit afficher `ok = true`. Seul le contrôle 10 peut rester à `false` si la migration a été collée dans l'éditeur au lieu de passer par `supabase db push`.

### Vercel

- Framework : Vite. Les fonctions de `api/` sont détectées automatiquement.
- Variables : voir `.env.example`. `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` et `CRON_SECRET` ne vont **jamais** dans une variable `VITE_`.
- Les tâches sont déclarées dans `vercel.json` : l'agent de prospection à 5 h UTC et la préparation des envois à 6 h UTC, du lundi au vendredi. L'agent peut durer jusqu'à 5 minutes (`maxDuration: 300`, ce qui demande le Fluid Compute de Vercel, activé par défaut).

## Plateforme multi-pôles (Groupe Senyara)

Un seul CRM pour trois activités : **Swipe Sales** (SaaS de recrutement commercial), **Amandis School** (formation) et **Groupe Senyara · Web & IA** (agence web, applications, logiciels, IA, automatisation ; identifiant technique `northreef`, nom face aux prospects : « Groupe Senyara »). Aucune limite géographique : toute la France.

- `prospects` reste le **référentiel unique des entreprises** : une fiche par entreprise, sans doublon.
- `opportunities` : **une opportunité par entreprise et par pôle**, avec son pipeline, son score, sa valeur estimée et sa prochaine action. Une entreprise peut intéresser plusieurs pôles, mais **un seul la sollicite à la fois** (règle de la base, aussi appliquée à l'enregistrement des contacts).
- `contacts` : plusieurs interlocuteurs par entreprise, chacun sourcé et avec son opposition propre.
- `business_units` : les pôles et leurs objectifs. `unit_facts` : offres, tarifs, certifications et références par pôle. **Seul Yannis confirme un fait**, et l'IA n'utilise que le confirmé.
- `interactions`, `outbox`, `campaigns`, `content` et `ai_usage` portent le pôle (`swipsales` par défaut), donc les échanges ne se mélangent pas.
- `missions` : demandes faites en langage naturel à l'orchestrateur (lot 3).
- **Transition Swipe Sales** : le pipeline historique (`prospects.stage`) reste la source, et l'opportunité Swipe Sales le suit par déclencheur. Les écrans actuels fonctionnent sans changement.
- **Garde-fou** (`src/domain/claims.ts`) : un brouillon qui affirme une certification (Qualiopi…), un financement (OPCO, CPF…), un prix, une référence client, un chiffre de résultat ou une fausse urgence sans fait confirmé correspondant est bloqué « À vérifier ».
- Dossiers des pôles : `src/domain/units.ts` (offres, cibles, signaux, qualification, pipeline, interdits). Indicateurs : `src/domain/opportunities.ts`.
- Retour arrière : `supabase/rollback/20261104150439_multi_units_down.sql`, testé par `supabase/rollback.test.ts`.

## LinkedIn du jour

Encart de l'écran **Aujourd'hui** : jusqu'à 10 décideurs à inviter par jour, choisis parmi les fiches recherchées par l'agent.

**Critères de sélection** : décideur identifié, note rédigée, sans opposition, jamais invité, pas contacté depuis 3 jours, pas sollicité par un autre pôle.

**Classement** : score du pôle, puis fraîcheur du signal.

**Pour chaque décideur** :
- lien vers son profil (ou une recherche LinkedIn s'il n'a pas été trouvé) ;
- note d'invitation modifiable, limitée à 300 caractères et contrôlée par le garde-fou ;
- bouton **« Invitation envoyée »** : il journalise le contact sur le bon pôle (opportunité activée, refusée par la base si un autre pôle sollicite déjà l'entreprise) et planifie la relance.

**L'envoi se fait à la main sur LinkedIn** : ses conditions interdisent l'automatisation.

## Opportunity Hunter

Veille des demandes de prestations publiées, analyse et propositions à valider. Ce module est intégré au CRM : une annonce retenue devient une fiche entreprise et une opportunité de pôle (bouton « Ajouter au CRM »). Onglet **Opportunity Hunter**.

**Modes** :
- **surveillance** : détecter et enregistrer ;
- **assisté** (par défaut) : détecter, qualifier, noter sur 100, rédiger la proposition et la soumettre à Yannis ;
- **automatique** : **indisponible**, tant qu'aucune plateforme n'autorise officiellement l'envoi automatique. La base refuse tout statut « envoyée auto ».

**Passages** : 6 h 30 et 12 h 30 UTC (`/api/cron/hunter`), ou le bouton « Lancer la veille maintenant ».

**Garde-fous** :
- arrêt d'urgence, réservé à Yannis ;
- limite quotidienne d'analyses IA (30 par défaut) ;
- anti-doublon par source ;
- journal de toutes les actions ;
- pré-filtre par mots-clés avant tout appel à l'IA, gratuit ;
- seul Yannis valide ;
- une proposition modifiée après validation est à revalider, et une proposition envoyée ne peut plus être modifiée ;
- garde-fou sur les affirmations (`claims.ts`) et pas de prix ferme sur un projet complexe non qualifié ;
- une référence client n'est proposée que si elle correspond au pôle et au type de prestation.

**Coût** : l'analyse porte sur le texte de l'annonce, sans recherche web. Avec Claude Haiku 5.5, comptez environ 0,001 à 0,003 $ par annonce analysée.

### Audit des plateformes (2026-11-05)

| Plateforme | Intégration officielle | Ce que fait l'outil |
|---|---|---|
| **BOAMP** (marchés publics) | API open data de la DILA, gratuite, sans clé, mise à jour 2 fois par jour | Lecture automatique des avis des 2 derniers jours, pré-filtre, analyse. La « proposition » est une note de réponse interne (pièces à préparer, points à vérifier). |
| **Codeur.com** | Flux RSS des projets par mots-clés, décrit par une source tierce. **À confirmer en production** : le domaine était injoignable depuis l'environnement de développement. | Lecture des flux RSS configurés. La réponse se fait sur Codeur, à la main (abonnement Codeur requis). |
| **Malt** | Pas d'API publique. Projets proposés par notification (e-mail, application). Protection anti-robots, recherche interdite aux robots. | Coller l'e-mail ou l'annonce dans l'outil. La lecture automatique d'une boîte dédiée aux notifications est à venir. |
| **ComeUp** | Pas d'API publique. Notifications de commandes et de messages. | Coller la demande dans l'outil. |
| **LinkedIn** | Pas d'API pour les demandes de prestations (Services Marketplace). Les conditions de l'API interdisent d'automatiser les publications. | Coller la demande dans l'outil. Aucune automatisation. |
| Autres flux RSS publics | Selon chaque site | Ajoutables dans les réglages (`settings.hunter.feeds`). |

Aucune protection n'est contournée : pas d'extraction de pages, pas de robot connecté à un compte.

## Agent de prospection

Chaque jour de semaine à 5 h UTC (`/api/cron/prospect`), ou à la demande depuis l'écran CRM (« Lancer l’agent maintenant », Yannis uniquement) :

1. **Détection** des annonces commerciales récentes :
   - **par défaut, par recherche web** : un seul appel par jour (4 recherches, aucune page lue, un thème différent chaque jour : SDR/BDR, terrain, business developer, technico-commercial, sédentaire B2B) ;
   - **ou par l'API France Travail** si `FRANCE_TRAVAIL_CLIENT_ID` et `FRANCE_TRAVAIL_CLIENT_SECRET` sont renseignés (gratuite et plus exhaustive, métiers ROME D1401 à D1408).
   
   Dans les deux cas, les agences d'intérim, les cabinets et les annonces « pour le compte d'un client » sont écartés.
2. **Fiche légale** : rapprochement avec le registre public des entreprises (API Recherche d'entreprises de l'État) : SIREN, activité, effectif et dirigeants. Seules les **PME de 10 à 249 salariés** sont retenues, et une entreprise n'est créée qu'une fois par SIREN.
3. **Recherche web par l'IA** (Claude, recherche et lecture de pages faites par Anthropic) : site officiel, coordonnées publiques (standard, e-mails génériques et nominatifs publiés), décideurs, faits récents, signaux d'achat, angles d'approche, qualification, puis une **première approche personnalisée** (e-mail, LinkedIn, script d'appel) en brouillon à valider.
4. **Rien n'est envoyé.** Les fiches arrivent en « Entreprise identifiée », et les brouillons attendent la validation de Yannis.

Plafond : `RESEARCH_DAILY_LIMIT` fiches par jour (10 par défaut), partagé avec le bouton « Rechercher avec l’IA » de la fiche.

**Coût** (modèle par défaut `RESEARCH_MODEL=claude-haiku-5-5`, à 0,10 $ / 0,50 $ par million de jetons, plus 0,01 $ par recherche web) :

| Étape | Limites | Coût estimé |
|---|---|---|
| Détection web (1 fois par jour) | 4 recherches, 0 page lue | ~0,05 $ |
| Recherche d'une entreprise | 3 recherches, 3 pages de 5 000 jetons au plus | ~0,03 à 0,05 $ |
| **Journée de 10 fiches** | | **~0,40 à 0,60 $** |

Le registre des entreprises et France Travail sont gratuits. Le coût estimé de chaque dossier et de chaque passage de l'agent est affiché dans l'interface. La rédaction à la demande (« Rédiger avec Claude ») reste sur `ANTHROPIC_MODEL`.

Le CRM s'exporte en CSV (bouton « Exporter ») avec les coordonnées, leurs sources, le signal, le résumé et les angles.

### Cadre de collecte (RGPD, prospection B2B)

- **Données publiques et professionnelles uniquement**, chacune avec l'adresse de la page où elle a été lue. Une coordonnée sans source est rejetée par le serveur, et la base refuse une coordonnée sans source (`coordonnees_sourcees`).
- **Rien n'est deviné** : pas d'adresse reconstituée (prénom.nom@), pas de numéro déduit. Les adresses personnelles (gmail, hotmail, orange…) sont rejetées.
- **Pas d'ouverture de LinkedIn, Facebook ou Instagram** par l'agent (conditions d'utilisation). L'adresse d'un profil peut être citée depuis un résultat de recherche.
- **Information à la première prise de contact** : chaque e-mail cite la source de l'adresse et permet de refuser les relances. Une opposition passe la fiche en « Ne plus contacter » : plus aucune recherche ni aucun contact (règle portée par la base).
- **Durée de conservation** : un prospect sans réponse ne doit pas être gardé plus de 3 ans après le dernier contact (recommandation CNIL). La purge reste à mettre en place.

## Architecture

```
src/domain/     Règles métier pures, testées : score, doublons, séquences de campagne,
                Founding Recruiters, file de validation, préparation quotidienne,
                performances, suggestions de contenus, consignes IA
src/lib/        Client Supabase, conversion base <-> application, hook de données temps réel
src/ui/         Interface React (espaces de pilotage, fiche entreprise)
api/ai/         POST /api/ai/generate : rédaction (prompt construit côté serveur, plafond, journal d'usage)
api/cron/       GET /api/cron/prospect : agent de prospection (5 h UTC). GET /api/cron/daily : prépare les envois du jour (6 h UTC). N'envoient rien.
api/research.ts POST : recherche IA d'une fiche, ou lancement de l'agent par Yannis
supabase/       Migration + tests de la migration sur Postgres (PGlite)
scripts/        Import des données du prototype
prototype/      Prototype complet (HTML) : référence fonctionnelle et visuelle pour les écrans à porter
integrations/   Pack de suivi Stripe → Supabase, à intégrer dans le dépôt de l'application SwipSales
```

## Règles imposées par la base

| Règle | Où |
|---|---|
| Seul l'owner valide une campagne, un envoi ou une publication | déclencheurs `guard_campaign`, `guard_outbox`, `guard_content` |
| Une campagne validée puis modifiée repasse en brouillon | `guard_campaign` |
| Aucun envoi sans validation | contrainte `envoi_valide` |
| Aucun contact avec une entreprise en opposition | `guard_interaction`, `guard_outbox` |
| « Client payant » exige un abonnement Stripe `sub_…` vérifié | contrainte `client_payant_verifie` |
| Coordonnées seulement avec leur source | contrainte `coordonnees_sourcees` |
| Essai Founding : segment B et engagement écrit | contrainte `essai_segment_b` |
| Publication citant une entreprise : accord écrit requis | `guard_content` |
| Expérience payante : budget validé | contrainte `budget_valide` |
| Lecture réservée à l'équipe, suppression réservée à l'owner, rien pour `anon` | RLS |

## État du projet

**Fait et testé** :
- le domaine complet ;
- le schéma et ses règles ;
- la rédaction IA côté serveur, avec plafond ;
- la préparation quotidienne des envois ;
- l'import des données ;
- les écrans : Aujourd'hui, CRM, fiche entreprise, Partenariats, Founding, Campagnes avec validation des envois, Communication, Performances.

**Reste à faire, dans l'ordre** :
1. **Envoi des e-mails validés.** En attente de la décision de Yannis sur la boîte d'envoi (Gmail ou domaine dédié). Ajouter `api/cron/send.ts` : il lit `outbox` en statut `Validé`, envoie par SMTP ou par l'API Gmail, passe la ligne en `Envoyé` et journalise une interaction `contact_email`.
2. **Relevé des réponses** : lecture de la boîte d'envoi, interaction `reponse`, arrêt automatique de la séquence.
3. **Porter du prototype** : le formulaire de score détaillé, les mesures produit (relevés MRR), les dépenses, les expériences, les coûts et les réglages de la fiche produit.
4. **Activer la rédaction IA** (`AI_ENABLED=true`) une fois le coût validé par Yannis : environ 0,01 $ par message avec Sonnet 5.5.

**Ne seront pas automatisés** :
- LinkedIn : ses conditions d'utilisation interdisent l'automatisation des invitations et des messages ;
- WhatsApp vers des contacts qui n'ont pas accepté d'être contactés (règles de Meta) ;
- la prospection à froid via Brevo : ses conditions anti-spam l'interdisent.
