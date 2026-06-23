var _builtPath = null;

function buildPath(points) {
  var totalLength = 0;
  var segments = [];
  for (var i = 1; i < points.length; i++) {
    var dx = points[i].x - points[i - 1].x;
    var dy = points[i].y - points[i - 1].y;
    var len = Math.hypot(dx, dy);
    segments.push({ x0: points[i-1].x, y0: points[i-1].y, x1: points[i].x, y1: points[i].y, len: len, cumLen: totalLength });
    totalLength += len;
  }
  return { points: points, segments: segments, totalLength: totalLength };
}

function pointOnPath(path, t) {
  var target = Math.max(0, Math.min(1, t)) * path.totalLength;
  for (var i = 0; i < path.segments.length; i++) {
    var seg = path.segments[i];
    if (seg.cumLen + seg.len >= target) {
      var local = seg.len > 0 ? (target - seg.cumLen) / seg.len : 0;
      return { x: seg.x0 + (seg.x1 - seg.x0) * local, y: seg.y0 + (seg.y1 - seg.y0) * local };
    }
  }
  var last = path.points[path.points.length - 1];
  return { x: last.x, y: last.y };
}

function getMainPath() {
  if (!_builtPath && state.level && state.level.paths && state.level.paths[0]) {
    _builtPath = buildPath(state.level.paths[0].points);
  }
  return _builtPath;
}

function resetPath() {
  _builtPath = null;
}

function nearestBuildSpot(mx, my, radius) {
  if (!state.level) return null;
  var best = null;
  var bestDist = radius;
  var spots = state.level.buildSpots || [];
  for (var i = 0; i < spots.length; i++) {
    var d = Math.hypot(mx - spots[i].x, my - spots[i].y);
    if (d < bestDist) { bestDist = d; best = spots[i]; }
  }
  return best;
}
