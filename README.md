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
- La tâche quotidienne est déclarée dans `vercel.json` : du lundi au vendredi à 6 h UTC.

## Architecture

```
src/domain/     Règles métier pures, testées : score, doublons, séquences de campagne,
                Founding Recruiters, file de validation, préparation quotidienne,
                performances, suggestions de contenus, consignes IA
src/lib/        Client Supabase, conversion base <-> application, hook de données temps réel
src/ui/         Interface React (espaces de pilotage, fiche entreprise)
api/ai/         POST /api/ai/generate : rédaction (prompt construit côté serveur, plafond, journal d'usage)
api/cron/       GET /api/cron/daily : prépare les envois du jour en « À valider » et le rapport. N'envoie rien.
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
