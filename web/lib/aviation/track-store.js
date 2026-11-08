export async function initializeTracks(sql) {
 await sql`CREATE TABLE IF NOT EXISTS tm_aviation_position (
  aircraft_id TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (aircraft_id, observed_at))`;
 await sql`CREATE INDEX IF NOT EXISTS tm_aviation_position_time ON tm_aviation_position(observed_at)`;
 // Existing area snapshots may contain different real observations of one plane.
 await sql`INSERT INTO tm_aviation_position(aircraft_id,observed_at,lat,lon)
  SELECT a.id,a."asOf"::timestamptz,a.lat,a.lon
  FROM tm_aviation_snapshot s CROSS JOIN LATERAL
   jsonb_to_recordset(s.payload->'aircraft') AS a(id text,"asOf" text,lat double precision,lon double precision)
  WHERE s.updated_at>now()-interval '6 hours' AND a.id ~ '^~?[a-f0-9]{6}$'
   AND a."asOf"::timestamptz BETWEEN now()-interval '6 hours' AND now()+interval '1 minute'
   AND abs(a.lat)<=90 AND abs(a.lon)<=180
  ON CONFLICT DO NOTHING`;
}

export async function recordTracks(sql, aircraft) {
 await sql`INSERT INTO tm_aviation_position(aircraft_id,observed_at,lat,lon)
  SELECT a.id,a."asOf"::timestamptz,a.lat,a.lon
  FROM jsonb_to_recordset(${JSON.stringify(aircraft)}::jsonb)
   AS a(id text,"asOf" text,lat double precision,lon double precision)
  WHERE a."asOf"::timestamptz BETWEEN now()-interval '6 hours' AND now()+interval '1 minute'
  ON CONFLICT DO NOTHING`;
 await sql`DELETE FROM tm_aviation_position WHERE observed_at<now()-interval '6 hours'`;
}

export async function readTrack(sql, id) {
 const rows = await sql`SELECT lat,lon,observed_at AS "asOf" FROM (
  SELECT lat,lon,observed_at FROM tm_aviation_position
  WHERE aircraft_id=${id} AND observed_at BETWEEN now()-interval '6 hours' AND now()+interval '1 minute'
  ORDER BY observed_at DESC LIMIT 720) points ORDER BY observed_at`;
 return rows.map(p=>({...p,asOf:new Date(p.asOf).toISOString()}));
}
