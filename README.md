# Aviator Star Bot — moteur d'analyse statistique + bot Telegram

Outil personnel de **statistiques** sur les multiplicateurs d'Aviator que vous saisissez ou importez.
Indépendant : non affilié à Bwin ni à Spribe.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wadamaga402-arch/analyseur-aviator)

## Ce que fait le projet
- **STAR BOT SIGNAL** : ANALYSE EN COURS · DONNÉES INSUFFISANTES · ANALYSE HISTORIQUE DISPONIBLE · AUCUN AVANTAGE STATISTIQUE DÉTECTÉ · RISQUE ÉLEVÉ (données douteuses) · avantage « à confirmer » seulement après validation. Chaque signal indique les données utilisées, la validation et la limite. Aucun signal BUY, aucun multiplicateur futur, aucune confiance inventée.
- **Model Performance** (`walkForward`) : test prospectif. Avant chaque manche, la chance d'atteindre 2× est estimée avec les 100 manches précédentes seulement, puis comparée au résultat réel (score de Brier contre la théorie, IC 95 % de l'écart).
- **Data Quality** (`dataQuality`) : quantité, valeurs illisibles, conformité au jeu (khi²), répétitions suspectes, ordre chronologique, part de 1,00×, absence de direct.
- **Historical Analytics** (`windowStats`) : fenêtres 10/50/100/500/toutes.
- **Signal History** (`logEntry`, `scoreLog`) : chaque ajout, « Analyser » ou « Recalculer » enregistre l'analyse (300 max par profil) ; la manche qui a suivi est affichée dès qu'elle est importée.
- **Boutons** : Importer l'historique · Analyser · Recalculer · Exporter les résultats (JSON) · Effacer les données de test (profil actif seulement, après confirmation).
- **Tableau de bord** (menu Dashboard · History · Analytics · Strategy · Settings, barre d'onglets sur iPhone) : signal explicatif, cartes Average Multiplier / Total Games Analyzed / Data Integrity / Market Analysis, graphique des multiplicateurs importés, AI Probability Engine, Suggested Cashout descriptif, Last 10 Rounds, Top High Rollers (« Données indisponibles »), bouton Recalculate Data.
- **Moteur de validation** (`validate` dans `site/analyseur.html`, copié dans `src/engine.js`) : séparation chronologique 70 % entraînement / 30 % test, 42 règles essayées sur l'entraînement, meilleure règle appliquée au test, comparaison à la référence (miser à chaque manche) et à la théorie (−3 %), taux de réussite avec IC de Wilson, faux signaux, retour avec IC 95 %. Un avantage n'est déclaré que si la borne basse de l'IC du retour est positive sur au moins 100 mises de test et que la règle bat la référence.
- **Signaux** : ANALYSE EN COURS · DONNÉES INSUFFISANTES (< 30 manches réelles ou profil Démo) · ANALYSE HISTORIQUE DISPONIBLE (30 à 199) · RISQUE ÉLEVÉ (données non conformes à la distribution publiée, test du khi² p < 0,001, ou > 10 % de valeurs illisibles) · AUCUN AVANTAGE STATISTIQUE DÉTECTÉ · AVANTAGE OBSERVÉ HORS ÉCHANTILLON — À CONFIRMER (uniquement si la validation le démontre).
- **Site** (`public/index.html`) : saisie, liste collée, import CSV, profils, répartition, graphique, probabilités théoriques séparées des observations, source de chaque manche, journal des erreurs.
- **Serveur** (`src/worker.js`, Cloudflare Workers, gratuit) : stocke les profils (Durable Object), protège l'accès par une clé, relie un bot Telegram privé.
- **Bot Telegram** : `/start`, `/stats`, `/historique [n]`, `/ajouter 1,52 3,10`, `/signal`, `/aide`, et une notification à chaque nouvelle manche ajoutée.

## Ce que le projet ne fait pas
- **Aucune connexion à Bwin.** Bwin ne publie pas d'API pour Aviator, l'API de Spribe est réservée aux casinos sous licence, et les conditions de Bwin interdisent les robots et l'ingénierie inverse. L'indicateur affiche donc toujours « Direct : indisponible ».
- **Aucune prédiction.** `/signal` donne uniquement les probabilités théoriques (taux de retour de 97 %), les fréquences observées, la qualité des données et les limites.
- **Aucun pari.** Le code n'a aucune fonction de mise.
- Le site ne demande jamais vos identifiants Bwin.

## Limites connues
- Le moteur ne peut pas trouver d'avantage dans un jeu à tirages indépendants : c'est le résultat attendu et il est affiché tel quel.
- Avec 42 combinaisons essayées, un « avantage » isolé peut encore venir du hasard : il est toujours marqué « à confirmer ».
- Sur le serveur, le nombre de valeurs illisibles (Data Integrity) n'est compté que pendant la session.
- La lecture de captures d'écran ne fonctionne que dans la version Claude du site.

## Telegram en solution de secours (sans le site)
Le bot tourne sur le serveur Cloudflare, pas dans la page web : il marche même si le site est fermé ou cassé, avec le même moteur (`src/engine.js`) et la même base (Durable Object).

| Commande | Effet |
| --- | --- |
| `/start` | relie le bot et affiche le menu |
| `/aide` | liste des commandes |
| `/ajouter 1,52 3,10 1,20` | enregistre des manches réelles (300 max par message), confirme, recalcule et enregistre l'analyse |
| `/historique [n]` | n dernières manches (20 par défaut, 50 max) |
| `/stats` | nombre de manches, moyenne, médiane, répartition, qualité des données, signal |
| `/signal` | STAR BOT SIGNAL, validation hors échantillon, estimations vs résultats, limites |
| `/effacer` puis `/effacer oui` | efface l'historique du profil (confirmation valable 2 minutes) |
| `/test` | 8 vérifications du moteur et du stockage ; si la réponse arrive, Telegram fonctionne |

Sécurité : seul le compte `ALLOWED_USER_ID` est accepté (un inconnu reçoit son propre identifiant et rien d'autre), conversations privées uniquement, webhook protégé par un secret dérivé, jeton uniquement dans les secrets Cloudflare, aucune fonction de mise.

Page d'installation de secours : `https://<votre-worker>.workers.dev/setup` (installer le webhook et tester sans le tableau de bord).

## Lancer en local
```
npm install
cp .dev.vars.example .dev.vars   # remplir BOT_TOKEN et ADMIN_KEY
npx wrangler dev                 # site sur http://localhost:8787
```

## Déployer (gratuit)
1. Pousser ce dépôt sur GitHub.
2. Cloudflare → Workers et Pages → Créer → Importer un dépôt → choisir le dépôt → Déployer (aucun réglage de build).
3. Ajouter les secrets ci-dessous, puis ouvrir l'adresse `….workers.dev`.

## Secrets (Cloudflare → Workers → analyseur-aviator → Paramètres → Variables et secrets)
| Nom | Valeur |
| --- | --- |
| `BOT_TOKEN` | Jeton donné par @BotFather |
| `ADMIN_KEY` | Clé d'accès au site, inventée par vous, 12 caractères minimum |
| `ALLOWED_USER_ID` | Votre identifiant Telegram (le bot vous le donne) : seul ce compte peut utiliser le bot |

## Développement
```
npm install
npm test                     # 24 tests du moteur + 28 tests site/serveur + 28 tests du bot seul (serveur Cloudflare local + faux Telegram, redémarrage inclus)
PW_PATH=<playwright> node test/dashboard.mjs   # 81 tests du tableau de bord (vide, boutons, export, effacement, iPhone 320-430 px, graphiques = données)
sh scripts/run-ui-test.sh    # site + serveur + Telegram dans un navigateur
```
Modifier le site : éditer `site/analyseur.html` puis `npm run build` (régénère `public/index.html` et `src/engine.js`).

Les jeux d'argent comportent un risque de perte financière. Aide : Joueurs Info Service 09 74 75 13 13 · jugarbien.es
