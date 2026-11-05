export const POSITION_TTL = 300000;

/**
 * Preserve actual last observations across incomplete snapshots. Never extend
 * their lifetime with a request timestamp or replace a newer position with an older one.
 * @param {import('../../components/fincept/AviationDesk').Aircraft[]} previous
 * @param {import('../../components/fincept/AviationDesk').Aircraft[]} incoming
 */
export function mergeObservations(previous, incoming, now = Date.now()) {
 const observations = new Map();
 for (const aircraft of previous) {
  const age = now - Date.parse(aircraft.asOf);
  if (Number.isFinite(age) && age >= -60000 && age < POSITION_TTL) {
   observations.set(aircraft.id, {...aircraft, stale: true});
  }
 }
 for (const aircraft of incoming) {
  const age = now - Date.parse(aircraft.asOf);
  if (!Number.isFinite(age) || age < -60000 || age >= POSITION_TTL) continue;
  const old = observations.get(aircraft.id);
  if (!old || Date.parse(aircraft.asOf) >= Date.parse(old.asOf)) {
   observations.set(aircraft.id, {...aircraft, stale: aircraft.stale || age > 60000});
  }
 }
 return [...observations.values()];
}
