export const TRACK_WINDOW = 6 * 60 * 60 * 1000;
const MAX_GAP = 10 * 60 * 1000;

// Only observed coordinates belong in the trail. Request times never add points.
export function mergeTrackPoints(groups, now = Date.now()) {
 const points = new Map();
 for (const group of groups) for (const point of group) {
  const time = Date.parse(point.asOf);
  if (!Number.isFinite(time) || time > now + 60000 || time < now - TRACK_WINDOW ||
      !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 ||
      !Number.isFinite(point.lon) || Math.abs(point.lon) > 180) continue;
  points.set(time, {lat:point.lat, lon:point.lon, asOf:new Date(time).toISOString()});
 }
 return [...points.entries()].sort((a,b)=>a[0]-b[0]).map(([,point])=>point).slice(-720);
}

export function trackSegments(points) {
 const segments = [];
 let segment = [];
 for (const point of points) {
  const last = segment.at(-1);
  if (last) {
   const gap = Date.parse(point.asOf) - Date.parse(last.asOf);
   const lat = (point.lat + last.lat) * Math.PI / 360;
   const distance = 111195 * Math.hypot(point.lat-last.lat, (point.lon-last.lon)*Math.cos(lat));
   // Avoid a line across missing reception, a position jump or the date line.
   if (gap <= 0 || gap > MAX_GAP || Math.abs(point.lon-last.lon)>180 || distance/gap>0.7) {
    if (segment.length > 1) segments.push(segment);
    segment = [];
   }
  }
  segment.push(point);
 }
 if (segment.length > 1) segments.push(segment);
 return segments;
}
