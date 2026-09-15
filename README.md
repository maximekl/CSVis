# CSVis

CSVis permet d’explorer un fichier CSV dans Cursor ou VS Code, sous forme de tableau, sans modifier son contenu. Vous pouvez chercher des lignes, trier et calculer des totaux avec une requête SQL. Le fichier reste sur votre ordinateur.

## Fonctionnalités

- Ouvrir un CSV directement en tableau, ou basculer entre tableau et texte.
- Parcourir les lignes et les colonnes, redimensionner les colonnes et passer d’une page de résultats à l’autre.
- Filtrer, trier, sélectionner des colonnes et calculer des statistiques avec SQL.
- Corriger la lecture du CSV : séparateur, présence d’un en-tête et encodage.
- Retrouver les réglages choisis pour un fichier dans le même espace de travail.
- Recharger la vue lorsque le CSV est modifié sur disque.
- Consulter les données en lecture seule, sans envoi du fichier à un service distant.

## Installation

Une fois CSVis publiée sur la Marketplace, ouvrez la vue **Extensions** de VS Code (`Cmd+Shift+X` sur macOS ou `Ctrl+Shift+X` sur Windows et Linux), recherchez **CSVis** par **MaximeK**, puis cliquez sur **Install**.

En attendant sa publication, la procédure d’installation à partir d’un VSIX figure dans [README_DEV.md](README_DEV.md).

## Découvrir les fonctions avec un exemple

Imaginez un fichier `scores.csv` contenant :

```csv
name,city,score
Alice,Paris,12
Bob,Lyon,8
Chloé,Paris,18
```

### Ouvrir et parcourir le tableau

Ouvrez `scores.csv` : CSVis affiche les trois lignes avec les colonnes `name`, `city` et `score`. Le nom et le type de chaque colonne apparaissent dans l’en-tête. Si une colonne est trop étroite, faites glisser son bord droit pour lire toute sa valeur.

Si le CSV est déjà ouvert comme texte, lancez **CSVis: Open CSV as Table** depuis la palette de commandes. Pour revoir le texte d’origine, lancez **View: Reopen Editor With…** puis choisissez **Text Editor**. La vue en tableau ne permet pas d’éditer les cellules.

### Chercher, trier et calculer avec SQL

Le tableau s’appelle `csv` dans les requêtes. Saisissez une requête dans **SQL query**, puis cliquez sur **Run query** ou utilisez `Cmd+Enter` / `Ctrl+Enter`.

Afficher seulement les personnes de Paris :

```sql
SELECT name, score FROM csv WHERE city = 'Paris'
```

Les résultats sont Alice (`12`) et Chloé (`18`). Pour classer tous les scores du plus grand au plus petit :

```sql
SELECT name, score FROM csv ORDER BY score DESC
```

Chloé apparaît alors en premier. Pour compter les lignes et additionner les scores :

```sql
SELECT count(*) AS personnes, sum(score) AS total FROM csv
```

Vous obtenez `3` personnes et un total de `38`. Les requêtes doivent uniquement lire les données : par exemple, `DELETE FROM csv` est refusé, tout comme la lecture d’un autre fichier. Si une requête est incorrecte, un message d’erreur apparaît sous la console.

### Passer d’une page à l’autre

Sur un CSV de 430 lignes, CSVis affiche les résultats par pages de 200 lignes. Cliquez sur **Next** pour voir les lignes 201 à 400, puis sur **Previous** pour revenir aux premières lignes. Une nouvelle requête revient à la page 1.

### Corriger la lecture d’un CSV

Dans **CSV settings**, vous pouvez modifier trois choix, puis cliquer sur **Apply settings** :

- **Delimiter** : si `name;city;score` apparaît dans une seule colonne, choisissez **Manual** et indiquez `;`.
- **Header row** : si la première ligne contient déjà des données, choisissez **Absent** pour ne pas la traiter comme un nom de colonne.
- **Encoding** : si les accents sont mal affichés, essayez **Latin-1** ou **UTF-16** selon le fichier.

Par exemple, réglez `ventes.csv` sur le séparateur `;`, fermez-le, puis rouvrez-le dans le même espace de travail : ce choix est retrouvé. Si vous ajoutez une ligne au fichier et l’enregistrez, le tableau se recharge ; si vous supprimez le fichier, CSVis affiche un message et attend qu’il soit recréé.

CSVis reste en lecture seule : aucune de ces actions ne modifie le CSV d’origine.
