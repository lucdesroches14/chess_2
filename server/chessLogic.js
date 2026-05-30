// Chess Logic - Server Side
// Handles all move validation, check detection, and win conditions

const PIECES = {
  KING: 'k', QUEEN: 'q', ROOK: 'r', BISHOP: 'b', KNIGHT: 'n', PAWN: 'p'
};

function initialBoard() {
  const board = Array(8).fill(null).map(() => Array(8).fill(null));
  const backRank = ['r','n','b','q','k','b','n','r'];
  for (let i = 0; i < 8; i++) {
    board[0][i] = { type: backRank[i], color: 'black', id: `b_${backRank[i]}_${i}` };
    board[1][i] = { type: 'p', color: 'black', id: `b_p_${i}` };
    board[6][i] = { type: 'p', color: 'white', id: `w_p_${i}` };
    board[7][i] = { type: backRank[i], color: 'white', id: `w_${backRank[i]}_${i}` };
  }
  return board;
}

function isInBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function getPseudoLegalMoves(board, row, col) {
  const piece = board[row][col];
  if (!piece) return [];
  const moves = [];
  const { type, color } = piece;
  const dir = color === 'white' ? -1 : 1;

  const addIfValid = (r, c, captureOnly = false, moveOnly = false) => {
    if (!isInBounds(r, c)) return false;
    const target = board[r][c];
    if (target && target.color === color) return false;
    if (moveOnly && target) return false;
    if (captureOnly && !target) return false;
    moves.push([r, c]);
    return !target;
  };

  const slide = (drs, dcs) => {
    for (let i = 0; i < drs.length; i++) {
      let r = row + drs[i], c = col + dcs[i];
      while (isInBounds(r, c)) {
        const target = board[r][c];
        if (target) {
          if (target.color !== color) moves.push([r, c]);
          break;
        }
        moves.push([r, c]);
        r += drs[i]; c += dcs[i];
      }
    }
  };

  switch (type) {
    case 'p':
      addIfValid(row + dir, col, false, true);
      if ((color === 'white' && row === 6) || (color === 'black' && row === 1)) {
        if (!board[row + dir][col]) addIfValid(row + 2 * dir, col, false, true);
      }
      addIfValid(row + dir, col - 1, true);
      addIfValid(row + dir, col + 1, true);
      break;
    case 'n':
      [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => addIfValid(row+dr, col+dc));
      break;
    case 'b':
      slide([-1,-1,1,1],[-1,1,-1,1]);
      break;
    case 'r':
      slide([-1,1,0,0],[0,0,-1,1]);
      break;
    case 'q':
      slide([-1,-1,1,1,-1,1,0,0],[-1,1,-1,1,0,0,-1,1]);
      break;
    case 'k':
      [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc]) => addIfValid(row+dr, col+dc));
      break;
  }
  return moves;
}

function isSquareAttackedBy(board, row, col, byColor) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === byColor) {
        const moves = getPseudoLegalMoves(board, r, c);
        if (moves.some(([mr, mc]) => mr === row && mc === col)) return true;
      }
    }
  }
  return false;
}

function findTrueKing(board, color, trueKingId) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === color && piece.id === trueKingId) return [r, c];
    }
  }
  return null;
}

function applyMove(board, from, to, promoteTo = 'q') {
  const newBoard = board.map(row => row.map(cell => cell ? { ...cell } : null));
  const piece = { ...newBoard[from[0]][from[1]] };
  newBoard[to[0]][to[1]] = piece;
  newBoard[from[0]][from[1]] = null;

  // Pawn promotion
  if (piece.type === 'p') {
    if ((piece.color === 'white' && to[0] === 0) || (piece.color === 'black' && to[0] === 7)) {
      newBoard[to[0]][to[1]] = { ...piece, type: promoteTo };
    }
  }
  return newBoard;
}

function getCastlingMoves(board, color, castlingRights) {
  const moves = [];
  const row = color === 'white' ? 7 : 0;
  const rights = castlingRights[color];

  if (rights.kingSide) {
    if (!board[row][5] && !board[row][6]) {
      if (!isSquareAttackedBy(board, row, 4, color === 'white' ? 'black' : 'white') &&
          !isSquareAttackedBy(board, row, 5, color === 'white' ? 'black' : 'white') &&
          !isSquareAttackedBy(board, row, 6, color === 'white' ? 'black' : 'white')) {
        moves.push([row, 6]);
      }
    }
  }
  if (rights.queenSide) {
    if (!board[row][1] && !board[row][2] && !board[row][3]) {
      if (!isSquareAttackedBy(board, row, 4, color === 'white' ? 'black' : 'white') &&
          !isSquareAttackedBy(board, row, 3, color === 'white' ? 'black' : 'white') &&
          !isSquareAttackedBy(board, row, 2, color === 'white' ? 'black' : 'white')) {
        moves.push([row, 2]);
      }
    }
  }
  return moves;
}

function getLegalMoves(board, row, col, gameState) {
  const piece = board[row][col];
  if (!piece) return [];

  const { trueKings, castlingRights } = gameState;
  const color = piece.color;
  const opponent = color === 'white' ? 'black' : 'white';
  const trueKingId = trueKings[color];

  let moves = getPseudoLegalMoves(board, row, col);

  // Add castling for the true king piece only
  if (piece.id === trueKingId) {
    const castleMoves = getCastlingMoves(board, color, castlingRights);
    moves = moves.concat(castleMoves);
  }

  // Chess 2: players are NOT forced to escape check — all pseudo-legal moves are allowed
  return moves;
}

function isTrueKingInCheck(board, color, trueKingId) {
  const kingPos = findTrueKing(board, color, trueKingId);
  if (!kingPos) return false;
  const opponent = color === 'white' ? 'black' : 'white';
  return isSquareAttackedBy(board, kingPos[0], kingPos[1], opponent);
}

function isCheckmate(board, color, gameState) {
  // Check if the color has any legal moves
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === color) {
        const moves = getLegalMoves(board, r, c, gameState);
        if (moves.length > 0) return false;
      }
    }
  }
  return true;
}

function isStalemate(board, color, gameState) {
  const trueKingId = gameState.trueKings[color];
  if (isTrueKingInCheck(board, color, trueKingId)) return false;
  return isCheckmate(board, color, gameState);
}

function applyMoveWithCastling(board, from, to, gameState) {
  const piece = board[from[0]][from[1]];
  const color = piece.color;
  const newBoard = applyMove(board, from, to);
  const newCastlingRights = JSON.parse(JSON.stringify(gameState.castlingRights));

  // Handle castling rook movement
  if (piece.id === gameState.trueKings[color]) {
    const row = color === 'white' ? 7 : 0;
    // King-side castle
    if (from[1] === 4 && to[1] === 6) {
      const rook = newBoard[row][7];
      newBoard[row][5] = rook ? { ...rook } : null;
      newBoard[row][7] = null;
    }
    // Queen-side castle
    if (from[1] === 4 && to[1] === 2) {
      const rook = newBoard[row][0];
      newBoard[row][3] = rook ? { ...rook } : null;
      newBoard[row][0] = null;
    }
    newCastlingRights[color] = { kingSide: false, queenSide: false };
  }

  // Revoke castling rights if rook moves
  if (piece.type === 'r') {
    if (from[0] === 7 && from[1] === 7) newCastlingRights.white.kingSide = false;
    if (from[0] === 7 && from[1] === 0) newCastlingRights.white.queenSide = false;
    if (from[0] === 0 && from[1] === 7) newCastlingRights.black.kingSide = false;
    if (from[0] === 0 && from[1] === 0) newCastlingRights.black.queenSide = false;
  }

  return { newBoard, newCastlingRights };
}

module.exports = {
  initialBoard,
  getLegalMoves,
  isTrueKingInCheck,
  isCheckmate,
  isStalemate,
  applyMoveWithCastling,
  findTrueKing
};
