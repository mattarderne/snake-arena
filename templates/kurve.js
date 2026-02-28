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
  const me = data.you;
  const board = data.board;
  const pos = me.position;
  const direction = me.direction;
  const speed = me.speed;
  const width = board.width;
  const height = board.height;

  // Look ahead: where will we be in N ticks for each move?
  function simulate(move, steps) {
    steps = steps || 15;
    let x = pos.x, y = pos.y, d = direction;
    for (let i = 0; i < steps; i++) {
      if (move === "left") d = (d + 5) % 360;
      else if (move === "right") d = ((d - 5) % 360 + 360) % 360;
      const rad = d * Math.PI / 180;
      x += Math.cos(rad) * speed;
      y += Math.sin(rad) * speed;
    }
    return { x, y };
  }

  // Score each move: prefer staying away from walls
  let bestMove = "straight";
  let bestScore = -999;

  for (const move of ["left", "right", "straight"]) {
    const future = simulate(move);
    let score = Math.min(future.x, future.y, width - future.x, height - future.y);

    if (future.x < 0 || future.x >= width || future.y < 0 || future.y >= height) {
      score = -1000;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

module.exports = { decideMove };
