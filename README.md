# CSVis

CSVis ouvre les fichiers CSV dans une grille en lecture seule dans Cursor ou VS Code desktop. Une console SQL DuckDB permet de filtrer, trier et agréger la table virtuelle `csv`. Le fichier reste local : CSVis ne l’envoie pas à un service distant et n’autorise pas les requêtes à lire d’autres fichiers.

## Installer le VSIX dans Cursor

La v1 fonctionne sur macOS Intel/ARM, Linux x64/ARM64 et Windows x64. Le workflow GitHub Actions actuel ne construit que le VSIX macOS ARM64 ; sur les autres plateformes, construisez le VSIX directement sur la machine cible afin d’y inclure le bon module natif DuckDB. Cursor ou VS Code doit prendre en charge les extensions ciblant l’API VS Code `^1.96.0`.

Sur la machine cible, avec Node.js 22 ou supérieur :

```sh
npm ci
npm run package
```

Le fichier généré est `dist/csvis-0.0.1-<plateforme>.vsix`, par exemple `dist/csvis-0.0.1-darwin-arm64.vsix` sur un Mac Apple Silicon. La commande refuse une plateforme non prise en charge ou une installation sans module DuckDB natif correspondant.

Dans Cursor, ouvrez la palette de commandes avec `Cmd+Shift+P` (macOS) ou `Ctrl+Shift+P` (Windows/Linux), lancez **Extensions: Install from VSIX…**, puis sélectionnez ce fichier. Recherchez ensuite **CSVis** dans les extensions installées. Le VSIX est local ; il n’est pas publié sur une marketplace.

## Utiliser la grille et SQL

Ouvrez un fichier `*.csv` : CSVis est l’éditeur par défaut. Si le fichier est déjà ouvert dans l’éditeur texte, lancez **CSVis: Open CSV as Table** depuis la palette de commandes. Pour revenir au texte, lancez **View: Reopen Editor With…** et choisissez **Text Editor**. La grille ne permet pas de modifier le CSV.

La requête initiale est `SELECT * FROM csv`. La console accepte un seul `SELECT` ou `WITH` à la fois, selon la syntaxe DuckDB. Exécutez-la avec **Run query** ou `Cmd+Enter` / `Ctrl+Enter`. Par exemple :

```sql
SELECT name, score FROM csv WHERE score >= 10 ORDER BY score DESC
```

```sql
SELECT count(*) AS lignes, sum(score) AS total FROM csv
```

Les résultats sont paginés par blocs de 200 lignes ; utilisez **Previous** et **Next**. Une nouvelle requête ou un changement de réglages repart à la première page. Les instructions de modification (`INSERT`, `DELETE`, `CREATE`, etc.), les requêtes multiples, les lectures d’autres fichiers et les accès externes sont refusés. Les erreurs SQL s’affichent dans la console sans fermer l’éditeur.

## Corriger la lecture du CSV

Le panneau **CSV settings** propose :

- **Delimiter** : détection automatique ou caractère manuel (par exemple `,`, `;` ou une tabulation).
- **Header row** : détection automatique, première ligne présente ou absence d’en-tête.
- **Encoding** : UTF-8, UTF-16 ou Latin-1.

Cliquez **Apply settings** pour reconstruire la vue `csv`. Les choix sont conservés par fichier et par espace de travail ; ils sont restaurés lorsque vous rouvrez ce fichier dans le même espace de travail. Si le CSV change sur disque, la vue se recharge ; s’il est supprimé, un message explicite remplace les résultats jusqu’à sa recréation.

## Développer et vérifier

Depuis un clone propre, avec Node.js 22 ou supérieur et npm :

```sh
npm ci
npm run typecheck
npm test
npm run package
npm run verify:package
```

`npm test` compile l’extension et la webview, exécute les tests unitaires et lance les scénarios d’intégration dans un Extension Development Host VS Code. `npm run verify:package` installe le VSIX dans un profil VS Code isolé, vérifie ses fichiers et relance ces scénarios ; ce profil temporaire est ensuite supprimé. Sur Linux sans écran, exécutez ces deux commandes avec `xvfb-run -a`. La recette de performance de 500 Mo est reproductible avec `npm run test:performance` et crée une fixture temporaire non versionnée.

Au premier lancement des tests d’intégration ou de `verify:package`, le harnais télécharge VS Code si aucune version n’est encore en cache ; prévoyez donc un accès réseau. Pour `npm test` et `npm run test:integration` en environnement hors ligne, `CSVIS_VSCODE_EXECUTABLE_PATH` peut désigner un exécutable VS Code déjà installé. Pour choisir une version VS Code mise en cache, utilisez `CSVIS_VSCODE_VERSION`.

Le code de l’Extension Host est dans `src/extension.ts`, la session CSV et l’éditeur personnalisé dans `src/editor/`, la source CSV et les options dans `src/csv/`, la validation et la pagination SQL dans `src/query/`, et l’interface React dans `src/webview/`. `src/shared/protocol.ts` définit les messages échangés entre l’Extension Host et la webview. Le packaging est réalisé par `scripts/package-vsix.mjs` ; le workflow macOS ARM64 se trouve dans `.github/workflows/build-vsix.yml`.

## Recette manuelle dans Cursor

À réaliser sur la plateforme du VSIX, avec un CSV réel dont vous connaissez au moins un total attendu :

1. Installez le VSIX via **Extensions: Install from VSIX…** et vérifiez que **CSVis** apparaît dans les extensions installées.
2. Ouvrez le CSV et vérifiez que la grille CSVis s’affiche par défaut, avec ses colonnes et la première page de données.
3. Exécutez `SELECT count(*) AS lignes FROM csv`, puis une agrégation sur une colonne numérique du fichier ; comparez les résultats à vos valeurs attendues.
4. Essayez un filtre ou un tri, puis, si le fichier a plus de 200 lignes, passez à la page suivante et revenez à la précédente.
5. Corrigez si nécessaire le séparateur, l’en-tête ou l’encodage ; fermez et rouvrez le CSV pour vérifier la persistance des réglages.
6. Lancez **View: Reopen Editor With…** → **Text Editor** et vérifiez que le contenu CSV d’origine est visible et inchangé.

Pour un essai déterministe sans CSV métier, `test/fixtures/comma.csv` contient deux lignes ; `SELECT count(*) AS lignes, sum(score) AS total FROM csv` doit donner `2` et `30.75`. Cet exemple ne remplace pas la recette avec un CSV réel.

Un CSV d’observations météo publiques est aussi disponible dans le [jeu de données Vega](https://github.com/vega/vega-datasets/blob/2434f551e0bb12b99a4ce6764fbc0ef39bea145e/data/seattle-weather.csv). Téléchargez cette révision figée dans un dossier temporaire, puis ouvrez-la dans Cursor :

```sh
curl -fL https://raw.githubusercontent.com/vega/vega-datasets/2434f551e0bb12b99a4ce6764fbc0ef39bea145e/data/seattle-weather.csv -o /tmp/seattle-weather.csv
```

Avec `SELECT count(*) AS jours, count(*) FILTER (WHERE precipitation > 0) AS jours_pluie FROM csv`, les résultats attendus sont `1461` jours et `623` jours de pluie. Le scénario automatisé optionnel peut être lancé avec `CSVIS_RECIPE_WEATHER_CSV_PATH=/tmp/seattle-weather.csv npm run test:integration` ; il vérifie aussi le retour au texte sans modification du CSV.
