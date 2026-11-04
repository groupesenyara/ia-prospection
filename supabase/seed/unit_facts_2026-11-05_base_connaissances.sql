-- Base de connaissances commerciales du Groupe Senyara (document de Yannis du 2026-11-05).
-- Seuls les éléments RENSEIGNÉS sont saisis comme « Confirmé ». Les champs laissés entre [crochets]
-- dans le document (prix manquants, durées, contacts, statut Qualiopi…) ne sont PAS saisis : l'IA les traite
-- comme « à confirmer avec Yannis ».
insert into public.unit_facts (unit, kind, text, status, source) values
-- Groupe Senyara : web, mobile, IA (pôle northreef)
('northreef','argument','Agence de développement web locale basée à Saint-Amand-les-Eaux (59), dirigée par Yannis Sénéchal','Confirmé','Base de connaissances 2026-11-05'),
('northreef','argument','La réalisation est assurée par Guillaume Cools, développeur (Node.js, React, TypeScript, hébergement Supabase / Vercel)','Confirmé','Base de connaissances 2026-11-05'),
('northreef','cible','Zone d''intervention : Hauts-de-France uniquement (pas le Benelux)','Confirmé','Base de connaissances 2026-11-05'),
('northreef','tarif','Site vitrine : à partir de 1 000 € HT','Confirmé','Base de connaissances 2026-11-05'),
('northreef','tarif','Boutique en ligne (e-commerce) : à partir de 2 000 € HT','Confirmé','Base de connaissances 2026-11-05'),
('northreef','tarif','Application métier ou logiciel sur mesure : sur devis après une phase de découverte','Confirmé','Base de connaissances 2026-11-05'),
('northreef','tarif','Application mobile : sur devis','Confirmé','Base de connaissances 2026-11-05'),
('northreef','tarif','Agent IA ou automatisation : sur devis','Confirmé','Base de connaissances 2026-11-05'),
('northreef','tarif','Carte ou plaque NFC avis Google, personnalisée au logo du commerce, programmée, installée et testée sur place : 60 € HT l''unité','Confirmé','Base de connaissances 2026-11-05'),
('northreef','tarif','Remise de 5 % pour les entreprises nouvellement créées à Saint-Amand-les-Eaux (site, cartes ou communication)','Confirmé','Base de connaissances 2026-11-05'),
('northreef','tarif','Les prix sont des prix « à partir de » ; le prix final est fixé au devis, validé par Yannis avant envoi','Confirmé','Base de connaissances 2026-11-05'),
('northreef','offre','Régie : mise à disposition de Guillaume Cools, développeur','Confirmé','Base de connaissances 2026-11-05'),
('northreef','offre','Cartes de menu et supports de communication','Confirmé','Base de connaissances 2026-11-05'),
('northreef','reference','Phil Multi-Services (réparation d''électroménager, Saint-Amand-les-Eaux) : site web philmultiservices59.fr et gestion de la communication sur les réseaux sociaux','Confirmé','Base de connaissances 2026-11-05'),
('northreef','reference','Destock Saint-Amand : site web','Confirmé','Base de connaissances 2026-11-05'),
('northreef','reference','Un garage automobile : logiciel de gestion sur mesure, V1 prête à sortir (ne pas citer le nom du garage sans son accord)','Confirmé','Base de connaissances 2026-11-05'),
('northreef','reference','Bosphore Kebab : cartes de menu','Confirmé','Base de connaissances 2026-11-05'),
('northreef','reference','Le Raisin Clair : site web EN COURS de réalisation (ne pas le présenter comme livré)','Confirmé','Base de connaissances 2026-11-05'),
('northreef','interdit','Une référence client ne se cite que pour le type de prestation réellement livré (Phil Multi-Services n''est pas une référence d''application mobile)','Confirmé','Base de connaissances 2026-11-05'),
('northreef','interdit','Aucune promesse de résultat chiffré : nombre d''avis, classement Google, chiffre d''affaires','Confirmé','Base de connaissances 2026-11-05'),
('northreef','interdit','Cartes NFC avis Google : l''avis est proposé à tous les clients, sans contrepartie ni filtrage des mécontents ; jamais d''avis rédigés ou achetés ; pas de logo Google sur les supports ; on vend un service (personnalisation, programmation, installation, test), pas une carte nue','Confirmé','Base de connaissances 2026-11-05'),
-- SwipSales
('swipsales','argument','Matching par swipe : recruteur et candidat ne peuvent échanger qu''après un match réciproque','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','argument','À l''inscription, le candidat passe un test ADN sous forme de jeu, incluant un score de vente vérifié par l''équipe SwipSales','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','argument','Le recruteur publie ses offres ; le profil candidat est visible par tous les recruteurs inscrits','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','tarif','Recruteurs : offre payante, sans essai gratuit','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','tarif','Candidats : placement gratuit et identique pour tous (swipes, candidatures, messagerie, visibilité)','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','tarif','Candidats : offres optionnelles d''accompagnement de carrière à environ 15 € et 63 € (coach IA, e-books, test ADN approfondi et réévaluation tous les 6 mois, badge premium)','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','tarif','Affiliation : 10 % de commission','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','cible','Cibles prioritaires : recruteurs de commerciaux (entreprises, cabinets), écoles de commerce (partenariats), influenceurs (affiliation)','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','interdit','Ne jamais citer de chiffres SwipSales (inscrits, offres, matchs)','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','interdit','Le premium candidat ne donne aucune visibilité supplémentaire : ne jamais le présenter comme un moyen d''être mieux placé','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','interdit','Pas d''essai gratuit recruteur, sauf exception en ABM sur un gros compte, pour obtenir une référence, sur décision de Yannis uniquement','Confirmé','Base de connaissances 2026-11-05'),
-- Amandis School
('amandis','offre','Formations en vente, prospection, marketing digital et IA ; cybersécurité en co-production avec Samuel Desseaux (Erythix)','Confirmé','Base de connaissances 2026-11-05'),
('amandis','offre','Catalogue : AI Workbench Pro™ (IA appliquée au travail), Prospection / vente B2B, Marketing digital, Cybersécurité (avec Samuel Desseaux)','Confirmé','Base de connaissances 2026-11-05'),
('amandis','offre','Formation sur le site du client ou à distance (pas de local)','Confirmé','Base de connaissances 2026-11-05'),
('amandis','argument','Formateur : Yannis Sénéchal, Business Developer B2B ; ex-SDR, SDR Team Lead puis BDR chez Groupe Positive (Sarbacane) sur le lancement de User.com en France, où il a formé des SDR et signé des clients grands comptes','Confirmé','Base de connaissances 2026-11-05'),
('amandis','argument','Yannis Sénéchal : ancien président d''une agence de marketing digital (La Référence, 2023–2026)','Confirmé','Base de connaissances 2026-11-05'),
('amandis','argument','Yannis Sénéchal : expérience de terrain en porte-à-porte et en développement commercial multi-secteurs ; déjà intervenu en école de commerce','Confirmé','Base de connaissances 2026-11-05'),
('amandis','argument','Yannis Sénéchal : Mastère Ingénieur d''Affaires IT (Euridis Business School)','Confirmé','Base de connaissances 2026-11-05'),
('amandis','reference','Charna Voyage : formations','Confirmé','Base de connaissances 2026-11-05'),
-- Règles communes (portées par chaque pôle)
('swipsales','interdit','Une seule offre principale par message, une offre complémentaire au maximum','Confirmé','Base de connaissances 2026-11-05'),
('amandis','interdit','Une seule offre principale par message, une offre complémentaire au maximum','Confirmé','Base de connaissances 2026-11-05'),
('northreef','interdit','Une seule offre principale par message, une offre complémentaire au maximum','Confirmé','Base de connaissances 2026-11-05'),
-- Ventes croisées autorisées
('northreef','argument','Vente croisée autorisée : un commerce local qui a besoin d''un site peut aussi se voir proposer les cartes NFC avis Google','Confirmé','Base de connaissances 2026-11-05'),
('swipsales','argument','Vente croisée autorisée : une entreprise qui recrute des commerciaux peut se voir proposer SwipSales, puis la formation prospection Amandis pour les nouveaux recrutés','Confirmé','Base de connaissances 2026-11-05'),
('northreef','argument','Vente croisée autorisée : une entreprise qui veut gagner du temps administratif peut se voir proposer un agent IA ou une automatisation, puis la formation IA Amandis','Confirmé','Base de connaissances 2026-11-05');
