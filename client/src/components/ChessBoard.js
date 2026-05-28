import React, { useState, useEffect, useCallback } from 'react';
import { PIECE_UNICODE, squareColor, colToFile, rowToRank } from '../utils/helpers';

export default function ChessBoard({
  board,
  myColor,
  myTrueKingId,
  opponentTrueKingId,
  turn,
  status,
  isSelectingKing,
  onSquareClick,
  onKingSelect,
  selectedSquare,
  legalMoves,
  lastMove,
  inCheck
}) {
  const isFlipped = myColor === 'black';

  const rows = isFlipped ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
  const cols = isFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

  const isLegalMove = (row, col) => legalMoves.some(([r,c]) => r === row && c === col);
  const isSelected = (row, col) => selectedSquare && selectedSquare[0] === row && selectedSquare[1] === col;
  const isLastMove = (row, col) => lastMove && (
    (lastMove.from[0] === row && lastMove.from[1] === col) ||
    (lastMove.to[0] === row && lastMove.to[1] === col)
  );

  const getTrueKingPos = () => {
    if (!myTrueKingId || !board) return null;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r]?.[c]?.id === myTrueKingId) return [r, c];
      }
    }
    return null;
  };

  const trueKingPos = getTrueKingPos();
  const isKingInCheck = (row, col) =>
    inCheck && trueKingPos && trueKingPos[0] === row && trueKingPos[1] === col;

  const handleClick = (row, col) => {
    if (isSelectingKing) {
      const piece = board[row][col];
      if (piece && piece.color === myColor) {
        onKingSelect(piece.id);
      }
      return;
    }
    onSquareClick(row, col);
  };

  const getPieceDisplay = (piece, row, col) => {
    if (!piece) return null;
    const isMyTrueKing = piece.id === myTrueKingId;
    const isOpponentTrueKing = piece.id === opponentTrueKingId;
    const symbol = PIECE_UNICODE[piece.color][piece.type];

    return (
      <span
        className={`piece ${piece.color} ${isMyTrueKing ? 'true-king' : ''} ${isOpponentTrueKing ? 'revealed-king' : ''}`}
        title={isMyTrueKing ? '★ YOUR TRUE KING' : ''}
      >
        {symbol}
        {isMyTrueKing && <span className="king-marker">★</span>}
      </span>
    );
  };

  return (
    <div className={`board-wrapper ${isSelectingKing ? 'selecting-mode' : ''}`}>
      {isSelectingKing && (
        <div className="selection-overlay">
          <span>Click any of your pieces to designate as your True King</span>
        </div>
      )}
      <div className="board">
        {rows.map(row => (
          <div key={row} className="board-row">
            <span className="rank-label">{rowToRank(row)}</span>
            {cols.map(col => {
              const piece = board[row][col];
              const sq = squareColor(row, col);
              const legal = isLegalMove(row, col);
              const selected = isSelected(row, col);
              const lastMv = isLastMove(row, col);
              const check = isKingInCheck(row, col);
              const canSelect = isSelectingKing && piece && piece.color === myColor;

              return (
                <div
                  key={col}
                  className={[
                    'square',
                    sq,
                    selected ? 'selected' : '',
                    legal ? (piece ? 'capturable' : 'legal') : '',
                    lastMv ? 'last-move' : '',
                    check ? 'in-check' : '',
                    canSelect ? 'can-select' : '',
                    status === 'finished' && piece?.id === opponentTrueKingId ? 'revealed' : ''
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleClick(row, col)}
                >
                  {legal && !piece && <span className="dot" />}
                  {getPieceDisplay(piece, row, col)}
                </div>
              );
            })}
          </div>
        ))}
        <div className="file-labels">
          <span className="rank-spacer" />
          {cols.map(col => <span key={col} className="file-label">{colToFile(col)}</span>)}
        </div>
      </div>
    </div>
  );
}
