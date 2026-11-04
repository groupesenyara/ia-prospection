-- Faits commerciaux confirmés par Yannis (brief du 2026-11-04 et précisions du 2026-11-05), déjà saisis en production.
-- Rejouable sur une base vide. Les prix et les références clients ne sont pas encore connus : ils ne sont donc pas saisis.
insert into public.unit_facts (unit, kind, text, status, source) values
('swipsales','offre','Swipe Sales est une plateforme SaaS de recrutement spécialisée dans les profils commerciaux','Confirmé','Brief Yannis 2026-11-04'),
('swipsales','offre','Entreprises et candidats commerciaux se découvrent par swipe et échangent après un match','Confirmé','Brief Yannis 2026-11-04'),
('swipsales','cible','Cabinets de recrutement, entreprises qui recrutent des commerciaux, DRH et responsables recrutement, directeurs commerciaux, startups et PME, ESN et sociétés commerciales','Confirmé','Brief Yannis 2026-11-04'),
('amandis','offre','Amandis School est un organisme de formation aux nouveaux métiers et aux nouveaux usages numériques','Confirmé','Brief Yannis 2026-11-04'),
('amandis','offre','Formations : intelligence artificielle, utilisation professionnelle de l''IA, création et utilisation d''agents IA, automatisation des processus','Confirmé','Brief Yannis 2026-11-04'),
('amandis','offre','Formations : développement des compétences commerciales, prospection et négociation','Confirmé','Brief Yannis 2026-11-04'),
('amandis','offre','Accompagnement des entreprises dans leur transformation','Confirmé','Brief Yannis 2026-11-04'),
('amandis','cible','TPE et PME, dirigeants, DRH, responsables formation, directeurs commerciaux, organismes de formation, entreprises souhaitant former leurs collaborateurs','Confirmé','Brief Yannis 2026-11-04'),
('amandis','interdit','Amandis School n''est PAS certifiée Qualiopi : ne jamais mentionner Qualiopi','Confirmé','Yannis 2026-11-05'),
('amandis','interdit','Les formations Amandis School ne sont PAS éligibles au CPF : ne jamais mentionner le CPF','Confirmé','Yannis 2026-11-05'),
('amandis','interdit','Aucune prise en charge OPCO ni financement à mentionner tant que ce n''est pas confirmé','Confirmé','Yannis 2026-11-05'),
('northreef','offre','Développement web : sites vitrines, sites professionnels, e-commerce, refonte, optimisation et maintenance','Confirmé','Brief Yannis 2026-11-04'),
('northreef','offre','Développement informatique : applications web et mobiles, logiciels métiers, outils sur mesure, plateformes SaaS, espaces clients et portails professionnels','Confirmé','Brief Yannis 2026-11-04'),
('northreef','offre','IA et automatisation : agents IA, automatisation des tâches et de la prospection, intégrations API, connexion entre logiciels, digitalisation des processus internes, solutions IA personnalisées','Confirmé','Brief Yannis 2026-11-04'),
('northreef','cible','Artisans et commerçants, TPE et PME, entreprises locales, industries, cabinets professionnels, organismes de formation, startups, franchises, entreprises de services','Confirmé','Brief Yannis 2026-11-04');
