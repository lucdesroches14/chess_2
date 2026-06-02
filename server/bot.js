const {
  getLegalMoves,
  applyMoveWithCastling,
  findTrueKing,
  isSquareAttackedBy
} = require('./chessLogic');

const PIECE_VALUE = { p: 1, n: 3, b: 3.1, r: 5, q: 9, k: 3.5 };

function selectBotKing(board, color) {
  const pieces = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === color) pieces.push({ piece: p, r, c });
    }
  }

  const backRank = color === 'white' ? 7 : 0;
  const scored = pieces.map(({ piece, r, c }) => {
    let score = Math.random() * 4;
    if (piece.type === 'k') score -= 10;
    if (piece.type === 'q') score -= 2;
    if (r === backRank) score += 3;
    score += 3 - Math.abs(c - 3.5);
    return { piece, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const pool = scored.slice(0, Math.min(4, scored.length));
  return pool[Math.floor(Math.random() * pool.length)].piece.id;
}

function evaluate(board, botColor, botTrueKingId) {
  const humanColor = botColor === 'white' ? 'black' : 'white';

  const botKingPos = findTrueKing(board, botColor, botTrueKingId);
  if (!botKingPos) return -100000;

  let score = 0;

  if (isSquareAttackedBy(board, botKingPos[0], botKingPos[1], humanColor)) {
    score -= 500;
  }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const v = PIECE_VALUE[p.type] || 0;
      if (p.color === botColor) {
        score += v;
        if (r >= 2 && r <= 5 && c >= 2 && c <= 5) score += 0.1;
      } else {
        score -= v;
      }
    }
  }

  return score;
}

function getAllMoves(board, color, gameState) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === color) {
        for (const [tr, tc] of getLegalMoves(board, r, c, gameState)) {
          moves.push({ from: [r, c], to: [tr, tc] });
        }
      }
    }
  }
  return moves;
}

function alphaBeta(board, gameState, botColor, botTrueKingId, depth, alpha, beta, maximizing, deadline) {
  if (Date.now() > deadline) {
    return { score: evaluate(board, botColor, botTrueKingId), move: null, timedOut: true };
  }

  if (!findTrueKing(board, botColor, botTrueKingId)) {
    return { score: -100000, move: null };
  }

  if (depth === 0) {
    return { score: evaluate(board, botColor, botTrueKingId), move: null };
  }

  const currentColor = maximizing ? botColor : (botColor === 'white' ? 'black' : 'white');
  const moves = getAllMoves(board, currentColor, gameState);

  if (moves.length === 0) {
    return { score: evaluate(board, botColor, botTrueKingId), move: null };
  }

  // Captures-first move ordering improves alpha-beta pruning
  moves.sort((a, b) =>
    (board[b.to[0]][b.to[1]] ? 1 : 0) - (board[a.to[0]][a.to[1]] ? 1 : 0)
  );

  let bestMove = moves[0];
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    const { newBoard, newCastlingRights } = applyMoveWithCastling(board, move.from, move.to, gameState);

    // If human just captured the bot's true king, it's terminal
    if (!maximizing && !findTrueKing(newBoard, botColor, botTrueKingId)) {
      if (-100000 < bestScore) { bestScore = -100000; bestMove = move; }
      beta = Math.min(beta, bestScore);
      if (beta <= alpha) break;
      continue;
    }

    const newGameState = { trueKings: gameState.trueKings, castlingRights: newCastlingRights };
    const result = alphaBeta(newBoard, newGameState, botColor, botTrueKingId, depth - 1, alpha, beta, !maximizing, deadline);

    if (result.timedOut) return { score: bestScore, move: bestMove, timedOut: true };

    if (maximizing) {
      if (result.score > bestScore) { bestScore = result.score; bestMove = move; }
      alpha = Math.max(alpha, bestScore);
    } else {
      if (result.score < bestScore) { bestScore = result.score; bestMove = move; }
      beta = Math.min(beta, bestScore);
    }

    if (beta <= alpha) break;
  }

  return { score: bestScore, move: bestMove };
}

function chooseBotMove(board, color, gameState, difficulty) {
  const depthMap = { easy: 1, medium: 2, hard: 3 };
  const depth = depthMap[difficulty] || 2;
  const deadline = Date.now() + 1800;

  const allMoves = getAllMoves(board, color, gameState);
  if (allMoves.length === 0) return null;

  // Easy: 30% random moves
  if (difficulty === 'easy' && Math.random() < 0.3) {
    return allMoves[Math.floor(Math.random() * allMoves.length)];
  }

  // Shuffle before search so equal-scored moves get random tie-breaking
  for (let i = allMoves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allMoves[i], allMoves[j]] = [allMoves[j], allMoves[i]];
  }

  const botTrueKingId = gameState.trueKings[color];
  const result = alphaBeta(board, gameState, color, botTrueKingId, depth, -Infinity, Infinity, true, deadline);
  return result.move || allMoves[0];
}

module.exports = { selectBotKing, chooseBotMove };
