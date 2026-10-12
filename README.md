# Analyseur Aviator + bot Telegram

Outil personnel de **statistiques** sur les multiplicateurs d'Aviator que vous saisissez ou importez.
Indépendant : non affilié à Bwin ni à Spribe.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wadamaga402-arch/analyseur-aviator)

## Ce que fait le projet
- **Site** (`public/index.html`) : saisie, liste collée, import CSV, profils, répartition, graphique, probabilités théoriques séparées des observations, source de chaque manche, journal des erreurs.
- **Serveur** (`src/worker.js`, Cloudflare Workers, gratuit) : stocke les profils (Durable Object), protège l'accès par une clé, relie un bot Telegram privé.
- **Bot Telegram** : `/start`, `/stats`, `/historique [n]`, `/ajouter 1,52 3,10`, `/signal`, `/aide`, et une notification à chaque nouvelle manche ajoutée.

## Ce que le projet ne fait pas
- **Aucune connexion à Bwin.** Bwin ne publie pas d'API pour Aviator, l'API de Spribe est réservée aux casinos sous licence, et les conditions de Bwin interdisent les robots et l'ingénierie inverse. L'indicateur affiche donc toujours « Direct : indisponible ».
- **Aucune prédiction.** `/signal` donne uniquement les probabilités théoriques (taux de retour de 97 %), les fréquences observées, la qualité des données et les limites.
- **Aucun pari.** Le code n'a aucune fonction de mise.
- Le site ne demande jamais vos identifiants Bwin.

## Secrets (Cloudflare → Workers → analyseur-aviator → Paramètres → Variables et secrets)
| Nom | Valeur |
| --- | --- |
| `BOT_TOKEN` | Jeton donné par @BotFather |
| `ADMIN_KEY` | Clé d'accès au site, inventée par vous, 12 caractères minimum |

## Développement
```
npm install
npm test          # moteur + 25 tests de bout en bout (serveur Cloudflare local + faux Telegram)
sh scripts/run-ui-test.sh   # test du site dans un navigateur (Playwright requis)
```
Modifier le site : éditer `site/analyseur.html` puis `npm run build` (régénère `public/index.html` et `src/engine.js`).

Les jeux d'argent comportent un risque de perte financière. Aide : Joueurs Info Service 09 74 75 13 13 · jugarbien.es
