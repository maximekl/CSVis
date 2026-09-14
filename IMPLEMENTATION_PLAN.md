# Plan d’implémentation de CSVis

## Livrable

CSVis est une extension Cursor/VS Code desktop écrite en TypeScript. Elle permet d’ouvrir un fichier CSV dans une grille en colonnes, puis d’interroger son contenu avec une syntaxe SQL DuckDB.

Ce projet est indépendant du monorepo GensDeConfiance et se trouve dans `/Users/maxime/Documents/GitHub/CSVis`.

Chaque tâche de ce document est conçue pour représenter environ 30 à 90 minutes de travail. Une tâche doit être prise séparément et ne peut commencer que lorsque toutes ses dépendances sont terminées.

## Décisions d’architecture

- Extension Cursor/VS Code desktop TypeScript appelée `CSVis`.
- Éditeur CSV personnalisé ouvert par défaut, en lecture seule.
- Grille React virtualisée et compatible avec les thèmes Cursor.
- DuckDB Node exécuté localement dans l’Extension Host.
- Table virtuelle unique appelée `csv`.
- Requêtes limitées à un unique `SELECT` ou `WITH`.
- Pagination de 200 lignes, avec maximum configurable à 1 000.
- Détection automatique du CSV, avec correction manuelle du séparateur, de l’en-tête et de l’encodage.
- Cible : fichiers CSV jusqu’à 500 Mo.
- VSIX pour macOS Intel/ARM, Linux x64/ARM64 et Windows x64.
- Pas d’édition, d’export, de jointure multi-fichiers, de publication Marketplace, de Cursor Web ou de Windows ARM64 dans la v1.

## Tâches

### T01 — Initialiser le projet

- [x] Créer le dépôt npm/TypeScript indépendant, `.gitignore`, l’arborescence `src`, `test`, `scripts` et la configuration TypeScript.
- **Dépendances :** aucune.
- **Livrables :** manifeste npm minimal, configuration TypeScript et dossiers de travail.
- **Vérification :** `npm install` puis `npm run typecheck`.
- **Acceptation :** l’installation est reproductible et la compilation TypeScript vide réussit.
- **Commit :** `chore: initialize project`

### T02 — Déclarer l’extension Cursor

- [x] Configurer le manifeste avec `csvis.csvViewer`, le sélecteur `*.csv`, la priorité `default` et la commande `CSVis: Open CSV as Table`.
- **Dépendances :** T01.
- **Livrables :** contributions, événements d’activation et métadonnées de l’extension.
- **Vérification :** validation du manifeste par `vsce ls`.
- **Acceptation :** Cursor reconnaît l’extension et son éditeur personnalisé.
- **Commit :** `feat: register CSV editor`

### T03 — Définir le protocole typé

- [x] Créer les types partagés `CsvOptions`, `ColumnMetadata`, `QueryRequest`, `QueryResult` et les unions de messages host/webview.
- **Dépendances :** T01.
- **Livrables :** module TypeScript partagé entre l’Extension Host et la webview.
- **Vérification :** tests TypeScript des messages valides et invalides.
- **Acceptation :** aucun message non typé n’est échangé entre l’extension et la webview.
- **Commit :** `feat: define typed message protocol`

### T04 — Intégrer DuckDB Node

- [ ] Ajouter `@duckdb/node-api`, créer une instance en mémoire et gérer proprement la connexion et sa destruction.
- **Dépendances :** T01, T03.
- **Livrables :** adaptateur DuckDB isolé du reste de l’extension.
- **Vérification :** test exécutant `SELECT 42`.
- **Acceptation :** le résultat est récupéré sans bloquer l’Extension Host.
- **Commit :** `feat: add DuckDB runtime`

### T05 — Créer la source CSV virtuelle

- [ ] Construire la vue `csv` à partir du fichier ouvert avec l’auto-détection DuckDB.
- **Dépendances :** T04.
- **Livrables :** service de création et de remplacement de la vue CSV.
- **Vérification :** fixtures avec virgule, point-virgule, tabulation, guillemets et cellules multilignes.
- **Acceptation :** le schéma, les noms de colonnes et les types sont correctement exposés.
- **Commit :** `feat: create virtual CSV source`

### T06 — Gérer les réglages CSV

- [ ] Supporter le séparateur automatique ou manuel, l’en-tête automatique/présent/absent et les encodages UTF-8/UTF-16/Latin-1.
- **Dépendances :** T05.
- **Livrables :** options validées et reconstruction de la vue `csv`.
- **Vérification :** recréer la vue avec chaque combinaison supportée.
- **Acceptation :** une mauvaise détection peut être corrigée sans rouvrir le fichier.
- **Commit :** `feat: support CSV settings`

### T07 — Valider et paginer les requêtes

- [ ] Autoriser un seul `SELECT` ou `WITH`, refuser les autres instructions et envelopper la requête avec `LIMIT 201 OFFSET`.
- **Dépendances :** T03, T04.
- **Livrables :** validateur SQL et exécuteur paginé.
- **Vérification :** tests sur les filtres, agrégats, tris, CTE, requêtes multiples, DDL et DML.
- **Acceptation :** 200 lignes maximum sont retournées et `hasNextPage` est fiable.
- **Commit :** `feat: validate and paginate queries`

### T08 — Sérialiser les résultats

- [ ] Convertir les résultats DuckDB en données JSON sûres en préservant `NULL`, `BIGINT`, les décimaux, les dates et les types complexes.
- **Dépendances :** T04, T07.
- **Livrables :** sérialiseur de colonnes et de lignes.
- **Vérification :** fixture couvrant chaque type pris en charge.
- **Acceptation :** aucune perte de précision et aucun échec de sérialisation.
- **Commit :** `feat: serialize query results`

### T09 — Implémenter le cycle de vie de l’éditeur

- [ ] Enregistrer le `CustomReadonlyEditorProvider`, créer une session par fichier et libérer toutes les ressources à la fermeture.
- **Dépendances :** T02, T05, T07, T08.
- **Livrables :** fournisseur d’éditeur et gestionnaire de session CSV.
- **Vérification :** ouvrir, dupliquer et fermer plusieurs onglets CSV.
- **Acceptation :** aucune connexion DuckDB ou écoute de fichier ne subsiste après la fermeture.
- **Commit :** `feat: manage editor lifecycle`

### T10 — Construire la webview

- [ ] Mettre en place React, le bundling, la CSP stricte et le canal de messages avec l’Extension Host.
- **Dépendances :** T01, T03.
- **Livrables :** point d’entrée React, HTML sécurisé et pipeline de build webview.
- **Vérification :** la webview affiche un état de chargement puis un résultat simulé.
- **Acceptation :** aucune ressource distante ou aucun script inline n’est autorisé.
- **Commit :** `feat: build React webview`

### T11 — Construire la grille en colonnes

- [ ] Afficher les colonnes, leurs types, les lignes numérotées, `NULL`, un en-tête fixe, le redimensionnement et le défilement horizontal.
- **Dépendances :** T10.
- **Livrables :** composant de grille virtualisée et styles basés sur les variables de thème Cursor/VS Code.
- **Vérification :** tests avec de nombreuses lignes, colonnes et valeurs longues.
- **Acceptation :** seules les données de la page courante sont rendues.
- **Commit :** `feat: add virtualized data grid`

### T12 — Ajouter la console pseudo-SQL

- [ ] Ajouter la requête initiale `SELECT * FROM csv`, le bouton d’exécution, `Cmd/Ctrl+Enter`, les erreurs et les boutons précédent/suivant.
- **Dépendances :** T07, T09, T10, T11.
- **Livrables :** éditeur de requête, état d’exécution et contrôles de pagination.
- **Vérification :** exécuter une sélection, un filtre, une agrégation et naviguer entre deux pages.
- **Acceptation :** une erreur SQL reste dans la webview et ne ferme pas l’éditeur.
- **Commit :** `feat: add SQL query console`

### T13 — Ajouter le panneau de réglages CSV

- [ ] Construire l’interface des réglages et conserver les choix par URI dans `workspaceState`.
- **Dépendances :** T06, T09, T10.
- **Livrables :** formulaire des options CSV et mécanisme de persistance.
- **Vérification :** modifier les réglages, fermer puis rouvrir le fichier.
- **Acceptation :** les réglages sont restaurés et la requête repart à la première page.
- **Commit :** `feat: add CSV settings panel`

### T14 — Gérer les changements du fichier

- [ ] Surveiller la modification, la suppression et la recréation du CSV, puis recharger ou afficher un état explicite.
- **Dépendances :** T09, T12, T13.
- **Livrables :** surveillance du fichier et invalidation des requêtes obsolètes.
- **Vérification :** modifier et supprimer une fixture pendant que l’éditeur est ouvert.
- **Acceptation :** aucun résultat obsolète n’est affiché après un changement.
- **Commit :** `feat: handle CSV file changes`

### T15 — Renforcer la sécurité et les ressources

- [ ] Limiter DuckDB au chemin du fichier ouvert, désactiver les accès externes et les extensions, verrouiller la configuration et appliquer la limite mémoire.
- **Dépendances :** T04, T05, T07, T09.
- **Livrables :** configuration DuckDB restrictive et tests de sécurité.
- **Vérification :** tenter `COPY`, `ATTACH`, `INSTALL`, une lecture d’un autre fichier et une modification de configuration.
- **Acceptation :** toutes ces opérations sont refusées tandis que `SELECT * FROM csv` fonctionne.
- **Commit :** `security: restrict DuckDB access`

### T16 — Ajouter les tests d’intégration

- [ ] Configurer `@vscode/test-electron` et tester l’activation, l’ouverture par défaut, les requêtes, les erreurs et la fermeture.
- **Dépendances :** T11, T12, T13, T14, T15.
- **Livrables :** configuration de l’Extension Development Host et scénarios d’intégration.
- **Vérification :** `npm test`.
- **Acceptation :** la suite complète est verte dans un Extension Development Host.
- **Commit :** `test: add extension integration tests`

### T17 — Valider un CSV de 500 Mo

- [ ] Générer une fixture temporaire non versionnée et mesurer l’ouverture, la pagination, la mémoire et le nettoyage.
- **Dépendances :** T15, T16.
- **Livrables :** générateur de fixture et scénario de performance reproductible.
- **Vérification :** `npm run test:performance`.
- **Acceptation :** aucun chargement intégral dans la webview, aucun crash et 201 lignes maximum transférées par requête.
- **Commit :** `test: validate 500MB CSV performance`

### T18 — Générer le VSIX local

- [ ] Ajouter le bundling de production, `.vscodeignore` et `npm run package` avec détection de la plateforme.
- **Dépendances :** T02, T15, T16.
- **Livrables :** script de packaging et VSIX dans `dist/`.
- **Vérification :** générer puis inspecter le contenu du VSIX.
- **Acceptation :** un fichier installable est produit sans sources ni fixtures inutiles.
- **Commit :** `build: package local VSIX`

### T19 — Ajouter les builds multiplateformes

- [ ] Créer une matrice GitHub Actions pour Darwin x64/ARM64, Linux x64/ARM64 et Windows x64.
- **Dépendances :** T18.
- **Livrables :** workflow de compilation, test et packaging multiplateforme.
- **Vérification :** chaque job exécute le build, les tests et le packaging.
- **Acceptation :** cinq artefacts VSIX nommés avec leur plateforme sont produits.
- **Commit :** `ci: add multiplatform builds`

### T20 — Documenter et effectuer la recette Cursor

- [ ] Documenter le développement, les raccourcis, la syntaxe SQL, les réglages, le packaging et l’installation via « Extensions: Install from VSIX ».
- **Dépendances :** T17, T18, T19.
- **Livrables :** README utilisateur/développeur et procédure de recette.
- **Vérification :** suivre le README depuis un clone propre et installer le VSIX dans Cursor.
- **Acceptation :** l’ouverture d’un CSV réel, une requête avec agrégation et le retour à l’éditeur texte réussissent.
- **Commit :** `docs: document and validate Cursor workflow`

## Ordre et parallélisation

```text
T01
├── T02 ───────────────────────────────┐
├── T03 ── T04 ── T05 ── T06 ────────┤
│            └──── T07 ── T08 ────────┤
└──────────── T10 ── T11 ─────────────┤
                                      T09
                         ┌─────────────┼── T12
                         ├─────────────┼── T13
                         └─────────────┴── T14
                                      └── T15
                                          └── T16
                                              ├── T17
                                              └── T18 ── T19
                                                        └── T20
```

- T02 et T03 peuvent être prises en parallèle après T01.
- T04 et T10 peuvent être prises en parallèle après leurs dépendances respectives.
- T06, T07 et T10 peuvent avancer en parallèle une fois leurs prérequis satisfaits.
- Deux tâches modifiant le même module doivent rester séquentielles, même si leurs dépendances permettent théoriquement un lancement parallèle.

## Règles d’exécution

- Une tâche n’est commencée que lorsque toutes ses dépendances sont terminées.
- Chaque tâche doit inclure ses tests dans la même modification.
- Une tâche n’est cochée qu’après réussite de sa commande de vérification.
- Chaque tâche terminée donne lieu à un commit Git unique utilisant le message indiqué dans sa section.
- La mise à jour de la case à cocher dans ce plan est incluse dans le même commit que l’implémentation de la tâche.
- Les modifications doivent rester limitées aux fichiers nécessaires à la tâche.
- Les échecs ou limitations doivent être consignés sous la tâche concernée.
- L’agent qui prend une tâche doit relire ses dépendances terminées avant de modifier le code.
- Si une tâche révèle une décision d’architecture manquante, elle doit être documentée avant de poursuivre.

## Définition globale de terminé

La v1 est terminée lorsque les vingt tâches sont cochées, que les tests unitaires et d’intégration sont verts, que le test de 500 Mo réussit, et qu’un VSIX peut être installé dans Cursor sur chaque plateforme prise en charge.
