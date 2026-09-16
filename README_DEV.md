# CSVis — documentation de développement

CSVis ouvre les fichiers CSV dans une grille en lecture seule dans Cursor ou VS Code desktop. Une console SQL DuckDB permet de filtrer, trier et agréger la table virtuelle `csv`. Le fichier reste local : CSVis ne l’envoie pas à un service distant et n’autorise pas les requêtes à lire d’autres fichiers.

## Installer un VSIX dans Cursor ou VS Code

La v1 fonctionne sur macOS Intel/ARM, Linux x64/ARM64 et Windows x64. Le workflow GitHub Actions construit les VSIX macOS ARM64, Linux x64 et Windows x64 ; sur les autres architectures, construisez le VSIX directement sur la machine cible afin d’y inclure le bon module natif DuckDB. Cursor ou VS Code doit prendre en charge les extensions ciblant l’API VS Code `^1.96.0`.

Lorsqu’une release est disponible, téléchargez le VSIX correspondant à votre plateforme depuis les [releases du dépôt](https://github.com/maximekl/CSVis/releases). Pour générer un VSIX localement ou couvrir une autre architecture, utilisez les commandes ci-dessous.

Sur la machine cible, avec Node.js 22 ou supérieur :

```sh
npm ci
npm run package
```

`npm run package` cible la plateforme et l’architecture de la machine actuelle. Pour produire explicitement les trois architectures de la release, même depuis une seule machine, utilisez :

```sh
npm run package:macos    # darwin-arm64
npm run package:linux    # linux-x64
npm run package:windows  # win32-x64
npm run package:all      # les trois VSIX ci-dessus
```

Chaque commande récupère au besoin le module DuckDB natif de la cible à la version verrouillée dans `package-lock.json`, puis supprime cette installation temporaire après le build. Chaque VSIX est contrôlé pour garantir qu’il contient un seul module natif DuckDB, celui de sa plateforme ; `package:all` produit donc trois archives séparées et non une archive universelle. Cette commande nécessite un accès au registre npm si les modules ne sont pas déjà présents. Les VSIX générés sont dans `dist/csvis-1.0.2-<plateforme>.vsix`. Pour macOS Intel ou Linux ARM64, utilisez `npm run package` directement sur la machine cible.

Dans Cursor ou VS Code, ouvrez la palette de commandes avec `Cmd+Shift+P` (macOS) ou `Ctrl+Shift+P` (Windows/Linux), lancez **Extensions: Install from VSIX…**, puis sélectionnez ce fichier. Recherchez ensuite **CSVis** dans les extensions installées. À ce jour, CSVis n’est pas publiée sur la Marketplace.

## Utiliser la grille et SQL

Ouvrez un fichier `*.csv` : CSVis est l’éditeur par défaut. Si le fichier est déjà ouvert dans l’éditeur texte, lancez **CSVis: Open CSV as Table** depuis la palette de commandes. Pour revenir au texte, lancez **View: Reopen Editor With…** et choisissez **Text Editor**. La grille ne permet pas de modifier le CSV.

La requête initiale est `SELECT * FROM csv`. La console accepte un seul `SELECT` ou `WITH` à la fois, selon la syntaxe DuckDB. Exécutez-la avec **Run query** ou `Cmd+Enter` / `Ctrl+Enter`. Par exemple :

```sql
SELECT name, score FROM csv WHERE score >= 10 ORDER BY score DESC
```

```sql
SELECT count(*) AS lignes, sum(score) AS total FROM csv
```

Les résultats sont paginés par blocs de 200 lignes ; utilisez **Previous** et **Next**. Cliquez une fois sur l’en-tête d’une colonne pour trier le résultat complet par ordre croissant, puis une seconde fois pour passer en ordre décroissant. Une nouvelle requête ou un changement de réglages repart à la première page. Les instructions de modification (`INSERT`, `DELETE`, `CREATE`, etc.), les requêtes multiples, les lectures d’autres fichiers et les accès externes sont refusés. Les erreurs SQL s’affichent dans la console sans fermer l’éditeur.

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

Le code de l’Extension Host est dans `src/extension.ts`, la session CSV et l’éditeur personnalisé dans `src/editor/`, la source CSV et les options dans `src/csv/`, la validation et la pagination SQL dans `src/query/`, et l’interface React dans `src/webview/`. `src/shared/protocol.ts` définit les messages échangés entre l’Extension Host et la webview. Le packaging est réalisé par `scripts/package-vsix.mjs` ; le workflow multiplateforme se trouve dans `.github/workflows/build-vsix.yml`.
