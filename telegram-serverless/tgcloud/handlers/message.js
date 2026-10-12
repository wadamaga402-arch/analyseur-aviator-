// Chaque message reçu par le bot passe ici.
import { onMessage } from '../lib/starbot.js';

export default async function (message, ctx) {
  await onMessage(message);
}
