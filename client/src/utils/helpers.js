export const PIECE_UNICODE = {
  white: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
  black: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
};

export const PIECE_NAMES = {
  k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn'
};

export function squareColor(row, col) {
  return (row + col) % 2 === 0 ? 'light' : 'dark';
}

export function colToFile(col) {
  return String.fromCharCode(97 + col);
}

export function rowToRank(row) {
  return 8 - row;
}

export function formatMove(move) {
  const { from, to, piece, captured } = move;
  const file1 = colToFile(from[1]);
  const rank1 = rowToRank(from[0]);
  const file2 = colToFile(to[1]);
  const rank2 = rowToRank(to[0]);
  return `${piece.toUpperCase()}${file1}${rank1}${captured ? 'x' : '-'}${file2}${rank2}`;
}
