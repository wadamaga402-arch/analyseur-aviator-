// Base de données d'Aviator Star Bot : une seule table clé → valeur (profils, manches, analyses, réglages).
import { table, text, json, integer } from 'sdk/db';

export const kv = table('kv', {
  key: text('key').primaryKey(),
  value: json('value'),
  updated: integer('updated'),
});
