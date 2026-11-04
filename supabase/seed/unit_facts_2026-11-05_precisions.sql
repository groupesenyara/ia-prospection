-- Précisions de Yannis du 2026-11-05, appliquées en production après la base de connaissances.
update public.business_units set name = 'Groupe Senyara · Web & IA', tagline = 'Agence web, applications, logiciels sur mesure, agents IA et automatisation (nom face aux prospects : Groupe Senyara)' where id = 'northreef';
-- Aucune limite géographique : toute la France
update public.unit_facts set text = 'Zone d''intervention : toute la France', source = 'Yannis 2026-11-05' where unit = 'northreef' and kind = 'cible' and text like 'Zone d''intervention%';
-- Amandis : ni Qualiopi ni CPF, aucune démarche en cours
update public.unit_facts set text = 'Amandis School n''est PAS certifiée Qualiopi et aucune démarche n''est en cours : ne jamais mentionner Qualiopi', source = 'Yannis 2026-11-05' where unit = 'amandis' and kind = 'interdit' and text like '%Qualiopi%';
update public.unit_facts set text = 'Aucune prise en charge OPCO, CPF ni autre financement à mentionner (ni Qualiopi ni CPF obtenus)', source = 'Yannis 2026-11-05' where unit = 'amandis' and kind = 'interdit' and text like 'Aucune prise en charge OPCO%';
-- Charna Voyage = agence Selectour, référence des deux pôles
update public.unit_facts set text = 'Charna Voyage (agence Selectour) : formations', source = 'Yannis 2026-11-05' where unit = 'amandis' and kind = 'reference' and text like 'Charna Voyage%';
-- Essai gratuit SwipSales : géré par Yannis seul
update public.unit_facts set text = 'Essai gratuit recruteur : réservé aux comptes sélectionnés et prospectés par Yannis lui-même pour obtenir des références. L''agent ne propose JAMAIS d''essai gratuit', source = 'Yannis 2026-11-05' where unit = 'swipsales' and kind = 'interdit' and text like 'Pas d''essai gratuit recruteur%';
insert into public.unit_facts (unit, kind, text, status, source) values
('northreef', 'reference', 'Charna Voyage (agence Selectour) : client du Groupe Senyara (préciser la prestation livrée avant de la citer pour un type de projet)', 'Confirmé', 'Yannis 2026-11-05'),
('northreef', 'interdit', 'Face aux prospects, le pôle se présente sous le nom « Groupe Senyara »', 'Confirmé', 'Yannis 2026-11-05');
