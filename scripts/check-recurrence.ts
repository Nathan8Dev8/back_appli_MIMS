/**
 * Vérifie le calcul des événements récurrents.   npm run check:recurrence
 */
import { strict as assert } from 'assert';
import { describe, localTime, occurrences } from '../src/events/recurrence';

// Affichage en heure du Cameroun (UTC+1), pour lire les résultats comme un humain.
const local = (dates: Date[]) =>
  dates.map((d) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 16).replace('T', ' '));
const from = new Date('2026-10-01T00:00:00Z');
const to = new Date('2027-01-31T23:00:00Z');

// « Nuit de prière chaque dernier vendredi du mois à 22h »
const lastFriday = { frequency: 'MONTHLY_NTH' as const, weekday: 5, nth: -1, time: '22:00' };
assert.deepEqual(local(occurrences(lastFriday, from, to)), ['2026-10-30 22:00', '2026-11-27 22:00', '2026-12-25 22:00', '2027-01-29 22:00']);
assert.equal(describe(lastFriday), 'chaque dernier vendredi du mois à 22h00');
// 22h à Douala = 21h UTC
assert.equal(occurrences(lastFriday, from, to)[0].toISOString(), '2026-10-30T21:00:00.000Z');
assert.equal(localTime(occurrences(lastFriday, from, to)[0]), '22:00');

// 2e dimanche du mois à 9h (comme la cotisation)
const secondSunday = { frequency: 'MONTHLY_NTH' as const, weekday: 0, nth: 2, time: '09:00' };
assert.deepEqual(local(occurrences(secondSunday, from, to)), ['2026-10-11 09:00', '2026-11-08 09:00', '2026-12-13 09:00', '2027-01-10 09:00']);

// Chaque mercredi à 18h30, sur 3 semaines
const weekly = { frequency: 'WEEKLY' as const, weekday: 3, time: '18:30' };
assert.deepEqual(local(occurrences(weekly, from, new Date('2026-10-21T23:00:00Z'))), ['2026-10-07 18:30', '2026-10-14 18:30', '2026-10-21 18:30']);
assert.equal(describe(weekly), 'chaque mercredi à 18h30');

// Le 31 de chaque mois → dernier jour pour les mois plus courts
const day31 = { frequency: 'MONTHLY_DAY' as const, monthDay: 31, time: '10:00' };
assert.deepEqual(local(occurrences(day31, from, to)), ['2026-10-31 10:00', '2026-11-30 10:00', '2026-12-31 10:00', '2027-01-31 10:00']);

// 4e vendredi : existe chaque mois (oct. 23, nov. 27, déc. 25, janv. 22)
const fourth = { frequency: 'MONTHLY_NTH' as const, weekday: 5, nth: 4, time: '20:00' };
assert.deepEqual(local(occurrences(fourth, from, to)), ['2026-10-23 20:00', '2026-11-27 20:00', '2026-12-25 20:00', '2027-01-22 20:00']);

// Une date déjà passée dans la journée n'est pas recréée
assert.deepEqual(local(occurrences(weekly, new Date('2026-10-07T18:00:00Z'), new Date('2026-10-14T23:00:00Z'))), ['2026-10-14 18:30']);

console.log('✅ Événements récurrents : tout est bon.');
