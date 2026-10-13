# Digit Pro — bot Deriv Digits (démo d'abord)

Un seul fichier : `dist/index.html` (aucun serveur, aucune base de données). Il parle directement à l'API WebSocket officielle de Deriv depuis votre navigateur.

## 1. Installation (iPhone)
1. Téléchargez `digit-pro.zip` (contient `index.html`).
2. Sur votre site Netlify : **Deploys → Deploy manually** (ou https://app.netlify.com/drop) → déposez le zip ou le dossier.
3. Ouvrez l'adresse du site dans Safari.

Sur ordinateur : `npm install`, puis `npm run build:digit` → `digit-pro/dist/index.html`.

## 2. Configuration Deriv (nouvelle API 2026)
Deriv a remplacé son ancienne API : les adresses `ws.derivws.com` / `ws.binaryws.com` et l'App ID 1089 ne marchent plus. Digit Pro utilise la nouvelle API officielle `https://api.derivws.com` (developers.deriv.com).
- **Sans rien configurer** : le site se connecte au flux public `wss://api.derivws.com/trading/v1/options/ws/public` (vrais ticks, sans compte) et calcule le signal. Sans compte, Deriv ne donne pas ses prix : le signal dit seulement si la règle fait mieux que le hasard.
- **Pour que le bot passe les ordres** (compte démo d'abord) :
  1. Connectez-vous sur **developers.deriv.com** avec votre compte Deriv, puis ouvrez le **Dashboard**.
  2. Enregistrez une application de type **PAT**. Notez son **App ID**.
  3. Dans le Dashboard, rubrique **API tokens**, créez un jeton avec le droit **trade**. Copiez-le tout de suite, car il ne s'affiche qu'une fois.
  4. Dans Digit Pro, ouvrez « Réglages avancés » et collez l'App ID (il est mémorisé sur ce téléphone). Collez le jeton dans le champ jeton, laissez Mode = Démo, puis appuyez sur **Connecter mon compte**.
  5. Le bot liste vos comptes, choisit le compte **démo**, demande un code à usage unique (OTP) et ouvre la connexion démo. À chaque reconnexion, il redemande un nouveau code.
- Le jeton reste en mémoire pendant la visite : il n'est jamais enregistré, ni affiché, ni écrit dans le journal, et il n'est envoyé qu'à `api.derivws.com` dans l'en-tête Authorization.

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
- **Signal automatique, sans compte** : à l'ouverture, la page se connecte toute seule à Deriv en lecture seule et calcule le signal, puis le met à jour toutes les 60 s (et à chaque changement de contrat ou de marché). Le jeton n'est nécessaire que pour que le bot achète : Deriv refuse tout achat sans jeton. Ajoutez `?manuel` à l'adresse pour désactiver la connexion automatique.
- **Écran Signal** (en haut) : choisissez Matches, Differs, Even ou Odd (ou « Actualiser le signal »). Le cercle orange suit les vraies étapes du calcul. Résultat : signal vert uniquement si le test hors échantillon montre un avantage, sinon « PAS DE SIGNAL ». La liste « Pourquoi ce signal » donne les vrais chiffres.
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
5. Comparez avec le relevé de votre compte démo Deriv : les 5 contrats doivent y figurer, avec les mêmes montants.
6. Testez **Arrêt d'urgence** pendant une session, et une coupure (mode avion 5 s) pendant une session.

## 6. Limites connues
- Les contrats Digits durent 1 tick : il **n'y a pas de stop loss individuel** possible. La protection est la perte max de session, vérifiée avant chaque achat.
- Les ticks Volatility sont générés par Deriv pour être aléatoires. Avec les paiements réels (ex. Matches 8,50 pour 1 = −15 % ; Even 1,95 = −2,5 %), l'espérance est **négative**. Le bot refusera presque toujours de valider une stratégie, et c'est le comportement correct.
- Les tests automatiques ont été faits contre une **imitation** de la nouvelle API Deriv, construite à partir de sa documentation publique (le serveur Deriv n'est pas accessible depuis l'environnement de développement). Certains détails ne sont pas documentés et n'ont pas pu être vérifiés : `contracts_for` et 5 000 ticks d'historique sur le flux public, et l'accès à l'API REST depuis un navigateur (CORS). Si une étape échoue, le message exact s'affiche dans le **Journal** (en bas de page). Le test sur le vrai compte démo (section 5) reste à faire par vous.
- Page fermée ou téléphone en veille : le bot s'arrête (aucun serveur). Un contrat déjà acheté se règle seul chez Deriv.
- Transactions parallèles non prises en charge.
- Aucun gain n'est garanti. Ce n'est pas un conseil financier.

## 7. Rapport de tests (automatisés)
- `node --test test/digit-engine.test.mjs` : **12/12** (tests statistiques, sur chiffres équitables ≤ 2 faux avantages sur 80, biais réel détecté, arrêts).
- `node test/digit-pro.mjs` (Chromium + fausse API Deriv) : **45/45**. Couvre : connexion, ticks, contrats, jeton refusé, jeton jamais exposé, analyse refusée, blocages, arrêt après exactement 5, objectif, perte max, arrêt d'urgence, réponse d'achat perdue sans doublon, coupure pendant le règlement, mode réel conditionnel, connexion et signal automatiques sans compte (aucun achat possible sans jeton), écran Signal (PAS DE SIGNAL sur chiffres équitables, signal vert seulement avec avantage), affichage mobile 320 à 430 px.
