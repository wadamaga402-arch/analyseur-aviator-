# Digit Pro — bot Deriv Digits (démo d'abord)

Un seul fichier : `dist/index.html` (aucun serveur, aucune base de données). Il parle directement à l'API WebSocket officielle de Deriv depuis votre navigateur.

## 1. Installation (iPhone)
1. Téléchargez `digit-pro.zip` (contient `index.html`).
2. Sur votre site Netlify : **Deploys → Deploy manually** (ou https://app.netlify.com/drop) → déposez le zip ou le dossier.
3. Ouvrez l'adresse du site dans Safari.

Sur ordinateur : `npm install`, puis `npm run build:digit` → `digit-pro/dist/index.html`.

## 2. Configuration Deriv
- **Jeton démo** : sur Deriv, basculez sur le compte **Démo** (VRTC…), puis Paramètres du compte → **Jeton API** → cochez **Read** et **Trade** uniquement (jamais Payments / Admin) → créez et copiez.
- Collez-le dans « Jeton API Deriv », puis **Se connecter**. Le jeton reste en mémoire pendant la visite : il n'est jamais enregistré, ni affiché, ni écrit dans le journal. Rechargez la page pour l'effacer.
- **Réglages avancés** : `app_id` 1089 (application de test publique de Deriv) et serveur `wss://ws.derivws.com/websockets/v3`. Vous pouvez créer votre propre app_id sur api.deriv.com si Deriv change ses adresses.
- Sans jeton : connexion en **lecture seule** (ticks et analyse, pas d'achat).

## 3. Réglages par défaut
| Paramètre | Valeur |
|---|---|
| Mise | 1 |
| Transactions max | 5 (arrêt après la 5ᵉ, pas de relance) |
| Objectif de bénéfice | 2 |
| Perte maximale | 5 |
| Pause entre transactions | 3 s |
| Exposition max | 5 |
| Fenêtre d'analyse | 100 ticks |
| Martingale | aucune, jamais de hausse de mise |
| Mode | Démo |

## 4. Fonctionnement
- **Écran Signal** (en haut) : choisissez Matches, Differs, Even ou Odd, puis « Obtenir le signal ». Le cercle orange suit les vraies étapes du calcul. Résultat : signal vert uniquement si le test hors échantillon montre un avantage, sinon « PAS DE SIGNAL ». La liste « Pourquoi ce signal » donne les vrais chiffres.
- **Analyser** : 5 000 vrais ticks + le vrai paiement demandé à Deriv. Les 60 % les plus anciens servent à choisir la fenêtre, et les 40 % restants (jamais vus) servent au test. Une stratégie n'est « validée » que si le rendement hors échantillon reste positif avec un intervalle de confiance à 95 %, sur au moins 300 cas. Sinon : **Stratégie refusée**.
- **Démo** : compte VRTC obligatoire. Sans avantage validé, il faut cocher « test technique en démo » pour vérifier le fonctionnement.
- **Réel** : il faut un compte réel, un avantage validé, la case cochée et `REEL` tapé. Sinon le mode est bloqué.
- Une seule transaction à la fois. Chaque résultat est lu sur le contrat Deriv (`proposal_open_contract`). Avant chaque achat, le bot vérifie que la perte la pire possible reste dans la limite.
- Coupure réseau : reconnexion automatique. Si la réponse d'achat est perdue, le bot cherche le contrat sur le compte (portfolio / profit_table) et **ne rachète jamais**.

## 5. Guide de test en démo
1. Connectez le compte démo. Vérifiez « Connecté · DÉMO », le solde et la devise.
2. Choisissez Volatility 10 (1s), puis Even, puis **Analyser**. Lisez le paiement réel et le verdict (normalement « refusée »).
3. Cochez « test technique », gardez Transactions max = 5, puis **Start**.
4. Vérifiez : exactement 5 lignes dans l'historique, arrêt « 5/5 », aucune relance. Le résultat net doit être égal à la variation du solde démo.
5. Comparez avec Deriv → Rapports → **Relevé** : les 5 contrats doivent y figurer, avec les mêmes montants.
6. Testez **Arrêt d'urgence** pendant une session, et une coupure (mode avion 5 s) pendant une session.

## 6. Limites connues
- Les contrats Digits durent 1 tick : il **n'y a pas de stop loss individuel** possible. La protection est la perte max de session, vérifiée avant chaque achat.
- Les ticks Volatility sont générés par Deriv pour être aléatoires. Avec les paiements réels (ex. Matches 8,50 pour 1 = −15 % ; Even 1,95 = −2,5 %), l'espérance est **négative**. Le bot refusera presque toujours de valider une stratégie, et c'est le comportement correct.
- Les tests automatiques ont été faits contre une **imitation** de l'API Deriv (le serveur Deriv n'est pas accessible depuis l'environnement de développement). Le test sur le vrai compte démo (section 5) reste à faire par vous.
- Page fermée ou téléphone en veille : le bot s'arrête (aucun serveur). Un contrat déjà acheté se règle seul chez Deriv.
- Transactions parallèles non prises en charge.
- Aucun gain n'est garanti. Ce n'est pas un conseil financier.

## 7. Rapport de tests (automatisés)
- `node --test test/digit-engine.test.mjs` : **11/11** (tests statistiques, sur chiffres équitables ≤ 2 faux avantages sur 80, biais réel détecté, arrêts).
- `node test/digit-pro.mjs` (Chromium + fausse API Deriv) : **38/38**. Couvre : connexion, ticks, contrats, jeton refusé, jeton jamais exposé, analyse refusée, blocages, arrêt après exactement 5, objectif, perte max, arrêt d'urgence, réponse d'achat perdue sans doublon, coupure pendant le règlement, mode réel conditionnel, écran Signal (PAS DE SIGNAL sur chiffres équitables, signal vert seulement avec avantage), affichage mobile 320 à 430 px.
