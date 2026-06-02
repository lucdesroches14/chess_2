import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChessBoard from './components/ChessBoard';
import { useSocket } from './hooks/useSocket';
import { PIECE_NAMES, formatMove } from './utils/helpers';
import './App.css';

function App() {
  const { emit, on, off, connected } = useSocket();
  const [screen, setScreen] = useState('lobby'); // lobby | waiting | selecting | playing | finished
  const [gameId, setGameId] = useState(null);
  const [myColor, setMyColor] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [inCheck, setInCheck] = useState(false);
  const [gameOverInfo, setGameOverInfo] = useState(null);
  const [joinInput, setJoinInput] = useState('');
  const [waitingMessage, setWaitingMessage] = useState('');
  const [rematchRequested, setRematchRequested] = useState(false);
  const [isSinglePlayer, setIsSinglePlayer] = useState(false);
  const [difficulty, setDifficulty] = useState('medium');
  const [preferredColor, setPreferredColor] = useState('white');
  const alertTimers = useRef([]);

  const addAlert = useCallback((msg, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setAlerts(prev => [...prev, { id, msg, type }]);
    const t = setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== id));
    }, duration);
    alertTimers.current.push(t);
  }, []);

  useEffect(() => {
    const unsubs = [
      on('gameCreated', ({ gameId, color, singlePlayer }) => {
        setGameId(gameId);
        setMyColor(color);
        if (singlePlayer) {
          setIsSinglePlayer(true);
          // Skip waiting screen — server emits gameStart immediately after
        } else {
          setScreen('waiting');
          setWaitingMessage(`Share this Game ID with your friend: ${gameId}`);
        }
      }),
      on('gameJoined', ({ gameId, color }) => {
        setGameId(gameId);
        setMyColor(color);
      }),
      on('gameStart', ({ message }) => {
        setScreen('selecting');
        addAlert(message, 'info', 6000);
      }),
      on('gameState', (state) => {
        setGameState(state);
        if (state.status === 'playing') setScreen('playing');
        if (state.status === 'finished') setScreen('finished');
      }),
      on('kingSelected', () => {
        addAlert('King selected! Waiting for opponent...', 'success');
      }),
      on('waitingForOpponent', ({ message }) => {
        addAlert(message, 'info', 10000);
      }),
      on('gameReady', ({ message }) => {
        addAlert(message, 'success');
        setScreen('playing');
      }),
      on('legalMoves', ({ moves, from }) => {
        setLegalMoves(moves);
        setSelectedSquare(from);
      }),
      on('inCheck', ({ message }) => {
        setInCheck(true);
        addAlert(`⚠️ ${message}`, 'warning', 5000);
      }),
      on('gameOver', (info) => {
        setGameOverInfo(info);
        setInCheck(false);
        addAlert(info.message, info.reason === 'stalemate' ? 'info' : 'success', 10000);
      }),
      on('opponentDisconnected', ({ message }) => {
        addAlert(message, 'warning', 8000);
      }),
      on('rematchRequested', ({ by }) => {
        if (by !== myColor) {
          setRematchRequested(true);
          addAlert('Opponent wants a rematch!', 'info', 8000);
        }
      }),
      on('rematchStarted', ({ color }) => {
        setMyColor(color);
        setGameState(null);
        setGameOverInfo(null);
        setRematchRequested(false);
        setInCheck(false);
        setSelectedSquare(null);
        setLegalMoves([]);
        setAlerts([]);
        setScreen('selecting');
      }),
      on('error', ({ message }) => {
        addAlert(`Error: ${message}`, 'error');
      }),
    ];

    return () => unsubs.forEach(u => u && u());
  }, [on, addAlert, myColor]);

  // Clear check state when turn changes
  useEffect(() => {
    if (gameState && gameState.turn === myColor) {
      setInCheck(false);
    }
  }, [gameState?.turn, myColor]);

  const handleCreateGame = () => emit('createGame');

  const handleJoinGame = () => {
    if (!joinInput.trim()) return;
    emit('joinGame', { gameId: joinInput.trim() });
  };

  const handleVsComputer = () => {
    emit('createSinglePlayer', { difficulty, color: preferredColor });
  };

  const handleKingSelect = (pieceId) => {
    emit('selectKing', { gameId, pieceId });
    addAlert('King selected! Waiting for opponent...', 'success');
  };

  const handleSquareClick = useCallback((row, col) => {
    if (!gameState || gameState.turn !== myColor || screen !== 'playing') return;

    const piece = gameState.board[row][col];

    if (selectedSquare && legalMoves.some(([r,c]) => r === row && c === col)) {
      emit('makeMove', { gameId, from: selectedSquare, to: [row, col] });
      setSelectedSquare(null);
      setLegalMoves([]);
      return;
    }

    if (piece && piece.color === myColor) {
      emit('requestMoves', { gameId, row, col });
      return;
    }

    setSelectedSquare(null);
    setLegalMoves([]);
  }, [gameState, myColor, screen, selectedSquare, legalMoves, emit, gameId]);

  const handleRematch = () => emit('requestRematch', { gameId });
  const handleAcceptRematch = () => emit('acceptRematch', { gameId });

  const lastMove = gameState?.moveHistory?.slice(-1)[0] || null;
  const isMyTurn = gameState?.turn === myColor;
  const opponentColor = myColor === 'white' ? 'black' : 'white';
  const opponentLabel = isSinglePlayer ? `Computer (${opponentColor})` : `Opponent (${opponentColor})`;

  const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  // ---- RENDER SCREENS ----

  if (screen === 'lobby') {
    return (
      <div className="app lobby">
        <div className="lobby-container">
          <div className="logo">
            <span className="logo-icon">♟</span>
            <h1>CHESS 2</h1>
            <p className="tagline">Hide your king. Find theirs.</p>
          </div>
          <div className="lobby-actions">
            <button className="btn primary" onClick={handleCreateGame} disabled={!connected}>
              Create Game
            </button>
            <div className="divider"><span>or</span></div>
            <div className="join-row">
              <input
                className="input"
                placeholder="Enter Game ID..."
                value={joinInput}
                onChange={e => setJoinInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleJoinGame()}
              />
              <button className="btn secondary" onClick={handleJoinGame} disabled={!connected || !joinInput.trim()}>
                Join
              </button>
            </div>
            <div className="divider"><span>or</span></div>
            <div className="vs-computer">
              <div className="vc-options">
                <div className="vc-option-group">
                  <span className="vc-label">Difficulty</span>
                  <div className="vc-pills">
                    {['easy', 'medium', 'hard'].map(d => (
                      <button
                        key={d}
                        className={`vc-pill ${difficulty === d ? 'active' : ''}`}
                        onClick={() => setDifficulty(d)}
                      >
                        {DIFFICULTY_LABELS[d]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="vc-option-group">
                  <span className="vc-label">Play as</span>
                  <div className="vc-pills">
                    <button
                      className={`vc-pill ${preferredColor === 'white' ? 'active' : ''}`}
                      onClick={() => setPreferredColor('white')}
                    >
                      White
                    </button>
                    <button
                      className={`vc-pill ${preferredColor === 'black' ? 'active' : ''}`}
                      onClick={() => setPreferredColor('black')}
                    >
                      Black
                    </button>
                  </div>
                </div>
              </div>
              <button className="btn primary" onClick={handleVsComputer} disabled={!connected}>
                Play vs Computer
              </button>
            </div>
          </div>
          <div className={`connection-status ${connected ? 'online' : 'offline'}`}>
            {connected ? '● Connected' : '○ Connecting...'}
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'waiting') {
    return (
      <div className="app lobby">
        <div className="lobby-container">
          <div className="logo">
            <span className="logo-icon">♟</span>
            <h1>CHESS 2</h1>
          </div>
          <div className="waiting-panel">
            <p className="waiting-label">Waiting for opponent...</p>
            <div className="game-id-box">
              <span className="game-id-label">Game ID</span>
              <span className="game-id-value">{gameId}</span>
              <button className="btn-copy" onClick={() => {navigator.clipboard.writeText(gameId); addAlert('Copied!', 'success', 2000);}}>
                Copy
              </button>
            </div>
            <p className="waiting-hint">Share this ID with your friend to start the game</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app game">
      {/* Alerts */}
      <div className="alerts">
        {alerts.map(a => (
          <div key={a.id} className={`alert ${a.type}`}>{a.msg}</div>
        ))}
      </div>

      <div className="game-layout">
        {/* Left sidebar */}
        <div className="sidebar left">
          <div className="brand">♟ CHESS 2</div>
          <div className="player-info">
            <div className={`player-card ${myColor} ${isMyTurn ? 'active' : ''}`}>
              <span className="player-symbol">{myColor === 'white' ? '♔' : '♚'}</span>
              <div>
                <div className="player-name">You ({myColor})</div>
                {isMyTurn && screen === 'playing' && <div className="your-turn">Your turn</div>}
              </div>
            </div>
            <div className={`player-card ${opponentColor} ${!isMyTurn && screen === 'playing' ? 'active' : ''}`}>
              <span className="player-symbol">{myColor === 'white' ? '♚' : '♔'}</span>
              <div>
                <div className="player-name">{opponentLabel}</div>
                {!isMyTurn && screen === 'playing' && <div className="thinking">Thinking...</div>}
              </div>
            </div>
          </div>

          {inCheck && screen === 'playing' && (
            <div className="check-banner">⚠️ YOUR KING IS IN CHECK</div>
          )}

          {gameState?.capturedPieces && (
            <div className="captured">
              <div className="captured-row">
                <span className="captured-label">Captured:</span>
                <span>{(gameState.capturedPieces[myColor] || []).map((p,i) => (
                  <span key={i} className="cap-piece">{p}</span>
                ))}</span>
              </div>
            </div>
          )}
        </div>

        {/* Board */}
        <div className="board-area">
          {gameState?.board && (
            <ChessBoard
              board={gameState.board}
              myColor={myColor}
              myTrueKingId={gameState.myTrueKingId}
              opponentTrueKingId={gameState.opponentTrueKingId}
              turn={gameState.turn}
              status={gameState.status}
              isSelectingKing={screen === 'selecting' && !gameState.kingSelectionDone?.[myColor]}
              onSquareClick={handleSquareClick}
              onKingSelect={handleKingSelect}
              selectedSquare={selectedSquare}
              legalMoves={legalMoves}
              lastMove={lastMove}
              inCheck={inCheck}
            />
          )}

          {/* Game over overlay */}
          {screen === 'finished' && gameOverInfo && (
            <div className="game-over-overlay">
              <div className="game-over-card">
                <div className="game-over-icon">
                  {gameOverInfo.winner === myColor ? '♛' : gameOverInfo.winner ? '♟' : '½'}
                </div>
                <h2>{gameOverInfo.message}</h2>
                <p className="game-over-reason">
                  {gameOverInfo.reason === 'capture' && 'The true king was captured'}
                  {gameOverInfo.reason === 'checkmate' && 'The true king was checkmated'}
                  {gameOverInfo.reason === 'stalemate' && 'No legal moves remaining'}
                </p>
                <div className="game-over-actions">
                  {isSinglePlayer ? (
                    <>
                      <button className="btn primary" onClick={handleAcceptRematch}>Play Again</button>
                      <button className="btn secondary" onClick={() => window.location.reload()}>Main Menu</button>
                    </>
                  ) : (
                    <>
                      {!rematchRequested ? (
                        <button className="btn primary" onClick={handleRematch}>Request Rematch</button>
                      ) : (
                        <button className="btn primary" onClick={handleAcceptRematch}>Accept Rematch</button>
                      )}
                      <button className="btn secondary" onClick={() => window.location.reload()}>New Game</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar - move history */}
        <div className="sidebar right">
          <div className="move-history">
            <h3>Move History</h3>
            <div className="moves-list">
              {(gameState?.moveHistory || []).reduce((acc, move, i) => {
                if (i % 2 === 0) acc.push([move]);
                else acc[acc.length - 1].push(move);
                return acc;
              }, []).map((pair, i) => (
                <div key={i} className="move-pair">
                  <span className="move-num">{i + 1}.</span>
                  <span className="move white">{formatMove(pair[0])}</span>
                  {pair[1] && <span className="move black">{formatMove(pair[1])}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="rules-reminder">
            <h4>Fog of War</h4>
            <ul>
              <li>★ marks your true king</li>
              <li>Only you receive check alerts</li>
              <li>Only your true king can castle</li>
              <li>Find & capture the enemy king</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
