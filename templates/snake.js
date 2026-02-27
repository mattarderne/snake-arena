/**
 * Snake Arena - Your Battlesnake Strategy
 *
 * Implement the decideMove function below. It receives the full game state
 * and must return one of: "up", "down", "left", "right".
 *
 * Game board: 11x11 grid. (0,0) is bottom-left, (10,10) is top-right.
 * Your snake dies if it hits a wall, another snake's body, or its own body.
 * Eat food to grow longer and restore health (starts at 100, -1 per turn).
 *
 * Docs: https://docs.battlesnake.com/api
 */

function decideMove(data) {
  const head = data.you.head;
  const board = data.board;
  const w = board.width;
  const h = board.height;

  // Collect all occupied cells
  const occupied = new Set();
  for (const snake of board.snakes) {
    for (const seg of snake.body) {
      occupied.add(`${seg.x},${seg.y}`);
    }
  }

  // Possible moves and their resulting positions
  const moves = {
    up: { x: head.x, y: head.y + 1 },
    down: { x: head.x, y: head.y - 1 },
    left: { x: head.x - 1, y: head.y },
    right: { x: head.x + 1, y: head.y },
  };

  // Filter for safe moves
  const safe = [];
  for (const [move, pos] of Object.entries(moves)) {
    if (
      pos.x >= 0 &&
      pos.x < w &&
      pos.y >= 0 &&
      pos.y < h &&
      !occupied.has(`${pos.x},${pos.y}`)
    ) {
      safe.push(move);
    }
  }

  if (safe.length === 0) return "up";

  // TODO: Add your strategy here!
  return safe[Math.floor(Math.random() * safe.length)];
}

module.exports = { decideMove };
