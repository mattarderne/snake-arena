/**
 * AI Arena - Kurve Strategy (Achtung die Kurve)
 *
 * Implement the decideMove function below. It receives the full game state
 * and must return one of: "left", "right", "straight".
 *
 * Game board: 640x480 continuous coordinate space. (0,0) is bottom-left.
 * Your player moves at constant speed (3 units/tick).
 * Turning rotates heading by ±5° per tick.
 * You leave a trail behind you — collision with walls, own trail, or
 * other trails means elimination. Last player alive wins.
 */

function decideMove(data) {
  var me = data.you;
  var board = data.board;
  var pos = me.position;
  var direction = me.direction;
  var speed = me.speed;
  var width = board.width;
  var height = board.height;

  // Gather all trail points from both players
  var allTrails = [];
  var trails = board.trails;
  for (var pid in trails) {
    var pts = trails[pid];
    for (var i = 0; i < pts.length; i++) {
      if (pts[i] !== null) allTrails.push(pts[i]);
    }
  }

  // Simulate a path for a given move over N steps
  // Returns minimum distance to any wall or trail point encountered
  function simulate(move, steps) {
    var x = pos.x, y = pos.y, d = direction;
    var minWallDist = Infinity;
    var minTrailDist = Infinity;
    var alive = true;

    for (var i = 0; i < steps; i++) {
      if (move === "left") d = (d + 5) % 360;
      else if (move === "right") d = ((d - 5) % 360 + 360) % 360;
      var rad = d * Math.PI / 180;
      x += Math.cos(rad) * speed;
      y += Math.sin(rad) * speed;

      // Wall distance
      var wd = Math.min(x, y, width - x, height - y);
      if (wd < 0) { alive = false; break; }
      if (wd < minWallDist) minWallDist = wd;

      // Trail distance (check against all known points)
      for (var j = 0; j < allTrails.length; j++) {
        var dx = x - allTrails[j][0];
        var dy = y - allTrails[j][1];
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 3.0) { alive = false; break; }
        if (dist < minTrailDist) minTrailDist = dist;
      }
      if (!alive) break;
    }

    return { alive: alive, stepsAlive: alive ? steps : i, minWallDist: minWallDist, minTrailDist: minTrailDist };
  }

  var bestMove = "straight";
  var bestScore = -Infinity;

  var moves = ["straight", "left", "right"];
  for (var m = 0; m < moves.length; m++) {
    var move = moves[m];
    var result = simulate(move, 25);

    var score;
    if (!result.alive) {
      // Died: score by how long we survived
      score = -1000 + result.stepsAlive;
    } else {
      // Alive: prefer distance from danger
      score = Math.min(result.minWallDist, result.minTrailDist * 2);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

module.exports = { decideMove };
