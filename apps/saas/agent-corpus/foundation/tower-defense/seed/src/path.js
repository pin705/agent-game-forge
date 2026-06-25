// path.js — polyline path: cache segment lengths once, look up world point at
// a distance along the path. Shares global `state`. (recipes/path-and-waves.md)
function buildPath(pathDef) {
  const pts = pathDef.points;
  const segLengths = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLengths.push(len);
    total += len;
  }
  return { id: pathDef.id, points: pts, segLengths, totalLength: total };
}

// Interpolated world point at distance `d` pixels along the path.
function pointAtDistance(path, d) {
  if (d <= 0) return { x: path.points[0].x, y: path.points[0].y };
  let acc = 0;
  for (let i = 0; i < path.segLengths.length; i++) {
    const seg = path.segLengths[i];
    if (acc + seg >= d) {
      const t = seg === 0 ? 0 : (d - acc) / seg;
      const a = path.points[i], b = path.points[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += seg;
  }
  const last = path.points[path.points.length - 1];
  return { x: last.x, y: last.y };
}
