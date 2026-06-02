const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const {
  initialBoard,
  getLegalMoves,
  isTrueKingInCheck,
  isCheckmate,
  isStalemate,
  applyMoveWithCastling
} = require('./chessLogic');
const { selectBotKing, chooseBotMove } = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const games = {};
const disconnectTimers = {}; // `${gameId}_${color}` -> timer id

function createGame() {
  return {
    id: uuidv4(),
    board: initialBoard(),
    players: {},        // socketId -> { color }
    colors: {},         // color -> socketId (null for bot)
    tokens: {},         // token -> color (durable player identity)
    trueKings: { white: null, black: null },
    kingSelectionDone: { white: false, black: false },
    castlingRights: {
      white: { kingSide: true, queenSide: true },
      black: { kingSide: true, queenSide: true }
    },
    turn: 'white',
    status: 'waiting',  // waiting | selecting | playing | finished
    winner: null,
    moveHistory: [],
    capturedPieces: { white: [], black: [] },
    mode: 'multiplayer', // multiplayer | single
    botColor: null,
    difficulty: 'medium'
  };
}

function getGameState(game, forColor) {
  return {
    board: game.board,
    turn: game.turn,
    status: game.status,
    winner: game.winner,
    myColor: forColor,
    myTrueKingId: game.trueKings[forColor],
    castlingRights: game.castlingRights,
    moveHistory: game.moveHistory,
    capturedPieces: game.capturedPieces,
    kingSelectionDone: game.kingSelectionDone,
    opponentTrueKingId: game.status === 'finished'
      ? game.trueKings[forColor === 'white' ? 'black' : 'white']
      : null
  };
}

// Safe emit helpers — no-op when the color has no socket (bot)
function emitToColor(game, color, event, data) {
  const sid = game.colors[color];
  if (sid) io.to(sid).emit(event, data);
}

function broadcastToPlayers(game, event, data) {
  emitToColor(game, 'white', event, data);
  emitToColor(game, 'black', event, data);
}

// Core move application — mutates game, emits events, handles win/draw detection.
// Callers are responsible for validating the move is legal before calling this.
function resolveMove(game, movingColor, from, to) {
  const piece = game.board[from[0]][from[1]];
  const opponent = movingColor === 'white' ? 'black' : 'white';
  const targetPiece = game.board[to[0]][to[1]];
  const opponentKingCaptured = targetPiece && targetPiece.id === game.trueKings[opponent];

  const { newBoard, newCastlingRights } = applyMoveWithCastling(
    game.board, from, to, { trueKings: game.trueKings, castlingRights: game.castlingRights }
  );

  game.moveHistory.push({
    from, to,
    piece: piece.type,
    color: movingColor,
    captured: targetPiece ? targetPiece.type : null
  });
  if (targetPiece) game.capturedPieces[movingColor].push(targetPiece.type);
  game.board = newBoard;
  game.castlingRights = newCastlingRights;

  if (opponentKingCaptured) {
    game.status = 'finished';
    game.winner = movingColor;
    emitToColor(game, 'white', 'gameState', getGameState(game, 'white'));
    emitToColor(game, 'black', 'gameState', getGameState(game, 'black'));
    broadcastToPlayers(game, 'gameOver', {
      reason: 'capture',
      winner: movingColor,
      message: `${movingColor === 'white' ? 'White' : 'Black'} Wins!`,
      capturedKingType: targetPiece.type,
      capturedKingSquare: to,
      capturedKingColor: opponent
    });
    return;
  }

  game.turn = opponent;

  const gsForLogic = { trueKings: game.trueKings, castlingRights: game.castlingRights };
  const opponentInCheck = isTrueKingInCheck(game.board, opponent, game.trueKings[opponent]);

  if (opponentInCheck && isCheckmate(game.board, opponent, gsForLogic)) {
    game.status = 'finished';
    game.winner = movingColor;
    emitToColor(game, 'white', 'gameState', getGameState(game, 'white'));
    emitToColor(game, 'black', 'gameState', getGameState(game, 'black'));
    broadcastToPlayers(game, 'gameOver', {
      reason: 'checkmate',
      winner: movingColor,
      message: `Checkmate - ${movingColor === 'white' ? 'White' : 'Black'} Wins!`
    });
    return;
  }

  if (isStalemate(game.board, opponent, gsForLogic)) {
    game.status = 'finished';
    game.winner = null;
    emitToColor(game, 'white', 'gameState', getGameState(game, 'white'));
    emitToColor(game, 'black', 'gameState', getGameState(game, 'black'));
    broadcastToPlayers(game, 'gameOver', {
      reason: 'stalemate',
      winner: null,
      message: 'Stalemate - Draw!'
    });
    return;
  }

  emitToColor(game, 'white', 'gameState', getGameState(game, 'white'));
  emitToColor(game, 'black', 'gameState', getGameState(game, 'black'));

  if (opponentInCheck) {
    emitToColor(game, opponent, 'inCheck', { message: 'Your king is in check!' });
  }
}

async function triggerBotMove(gameId) {
  const game = games[gameId];
  if (!game || game.status !== 'playing' || game.turn !== game.botColor) return;

  // Artificial thinking delay so the UI "Thinking..." state is visible
  const delay = 400 + Math.floor(Math.random() * 800);
  await new Promise(resolve => setTimeout(resolve, delay));

  const current = games[gameId];
  if (!current || current.status !== 'playing' || current.turn !== current.botColor) return;

  // Build a bot-safe gameState: bot knows its own true king but not the human's
  const humanColor = current.botColor === 'white' ? 'black' : 'white';
  const fallbackHumanKingId = `${humanColor[0]}_k_4`;
  const botGameState = {
    trueKings: {
      [current.botColor]: current.trueKings[current.botColor],
      [humanColor]: fallbackHumanKingId
    },
    castlingRights: current.castlingRights
  };

  const move = chooseBotMove(current.board, current.botColor, botGameState, current.difficulty);
  if (!move) return;

  // Belt-and-suspenders: validate using the real trueKings
  const gsReal = { trueKings: current.trueKings, castlingRights: current.castlingRights };
  const legal = getLegalMoves(current.board, move.from[0], move.from[1], gsReal);
  if (!legal.some(([r, c]) => r === move.to[0] && c === move.to[1])) {
    console.error('Bot chose illegal move:', move);
    return;
  }

  resolveMove(current, current.botColor, move.from, move.to);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('rejoinGame', ({ gameId, token }) => {
    const game = games[gameId];
    if (!game || game.status === 'finished') return;
    const color = game.tokens[token];
    if (!color) return;

    // Cancel any pending disconnect notification for this player
    const timerKey = `${gameId}_${color}`;
    if (disconnectTimers[timerKey]) {
      clearTimeout(disconnectTimers[timerKey]);
      delete disconnectTimers[timerKey];
    }

    // Rebind socket
    const oldSocketId = game.colors[color];
    if (oldSocketId && oldSocketId !== socket.id) {
      delete game.players[oldSocketId];
    }
    game.players[socket.id] = { color };
    game.colors[color] = socket.id;
    socket.join(gameId);

    socket.emit('gameRejoined', {
      color,
      gameId,
      singlePlayer: game.mode === 'single',
      status: game.status
    });
    socket.emit('gameState', getGameState(game, color));

    if (game.status === 'selecting') {
      socket.emit('gameStart', { message: 'Reconnected. Select your true king.' });
    }

    console.log(`Player rejoined game ${gameId} as ${color}`);
  });

  socket.on('createGame', () => {
    const game = createGame();
    games[game.id] = game;
    const token = uuidv4();
    game.tokens[token] = 'white';
    game.players[socket.id] = { color: 'white' };
    game.colors['white'] = socket.id;
    socket.join(game.id);
    socket.emit('gameCreated', { gameId: game.id, color: 'white', token });
    console.log('Game created:', game.id);
  });

  socket.on('createSinglePlayer', ({ difficulty = 'medium', color = 'white' } = {}) => {
    const game = createGame();
    games[game.id] = game;

    const humanColor = color;
    const botColor = color === 'white' ? 'black' : 'white';

    game.mode = 'single';
    game.difficulty = difficulty;
    game.botColor = botColor;

    const token = uuidv4();
    game.tokens[token] = humanColor;
    game.players[socket.id] = { color: humanColor };
    game.colors[humanColor] = socket.id;
    game.colors[botColor] = null; // bot has no socket

    // Bot auto-selects its true king immediately
    game.trueKings[botColor] = selectBotKing(game.board, botColor);
    game.kingSelectionDone[botColor] = true;

    game.status = 'selecting';
    socket.join(game.id);

    // singlePlayer flag tells the client to skip the waiting screen
    socket.emit('gameCreated', { gameId: game.id, color: humanColor, singlePlayer: true, token });
    socket.emit('gameStart', { message: 'Choose your true king.' });
    socket.emit('gameState', getGameState(game, humanColor));
    console.log('Single-player game created:', game.id, 'difficulty:', difficulty);
  });

  socket.on('joinGame', ({ gameId }) => {
    const game = games[gameId];
    if (!game) { socket.emit('error', { message: 'Game not found' }); return; }
    if (Object.keys(game.players).length >= 2) { socket.emit('error', { message: 'Game is full' }); return; }

    const token = uuidv4();
    game.tokens[token] = 'black';
    game.players[socket.id] = { color: 'black' };
    game.colors['black'] = socket.id;
    socket.join(gameId);
    game.status = 'selecting';

    socket.emit('gameJoined', { gameId, color: 'black', token });
    io.to(gameId).emit('gameStart', { message: 'Both players connected. Select your true king.' });
    emitToColor(game, 'white', 'gameState', getGameState(game, 'white'));
    emitToColor(game, 'black', 'gameState', getGameState(game, 'black'));
    console.log('Player joined game:', gameId);
  });

  socket.on('selectKing', ({ gameId, pieceId }) => {
    const game = games[gameId];
    if (!game || game.status !== 'selecting') return;

    const player = game.players[socket.id];
    if (!player) return;

    const color = player.color;
    if (game.kingSelectionDone[color]) return;

    let pieceFound = false;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = game.board[r][c];
        if (piece && piece.id === pieceId && piece.color === color) { pieceFound = true; break; }
      }
    }
    if (!pieceFound) { socket.emit('error', { message: 'Invalid piece selection' }); return; }

    game.trueKings[color] = pieceId;
    game.kingSelectionDone[color] = true;
    socket.emit('kingSelected', { pieceId });
    console.log(`${color} selected king: ${pieceId}`);

    if (game.kingSelectionDone.white && game.kingSelectionDone.black) {
      game.status = 'playing';
      emitToColor(game, 'white', 'gameState', getGameState(game, 'white'));
      emitToColor(game, 'black', 'gameState', getGameState(game, 'black'));
      broadcastToPlayers(game, 'gameReady', { message: 'Game started! White moves first.' });

      // In single-player, if bot has first move (human chose black), trigger it
      if (game.mode === 'single' && game.turn === game.botColor) {
        triggerBotMove(game.id);
      }
    } else {
      socket.emit('waitingForOpponent', { message: 'Waiting for opponent to select their king...' });
    }
  });

  socket.on('requestMoves', ({ gameId, row, col }) => {
    const game = games[gameId];
    if (!game || game.status !== 'playing') return;

    const player = game.players[socket.id];
    if (!player || player.color !== game.turn) return;

    const piece = game.board[row][col];
    if (!piece || piece.color !== player.color) return;

    const moves = getLegalMoves(game.board, row, col, {
      trueKings: game.trueKings,
      castlingRights: game.castlingRights
    });
    socket.emit('legalMoves', { moves, from: [row, col] });
  });

  socket.on('makeMove', ({ gameId, from, to }) => {
    const game = games[gameId];
    if (!game || game.status !== 'playing') return;

    const player = game.players[socket.id];
    if (!player || player.color !== game.turn) {
      socket.emit('error', { message: 'Not your turn' });
      return;
    }

    const piece = game.board[from[0]][from[1]];
    if (!piece || piece.color !== player.color) {
      socket.emit('error', { message: 'Invalid piece' });
      return;
    }

    const gsForLogic = { trueKings: game.trueKings, castlingRights: game.castlingRights };
    const legalMoves = getLegalMoves(game.board, from[0], from[1], gsForLogic);
    if (!legalMoves.some(([r, c]) => r === to[0] && c === to[1])) {
      socket.emit('error', { message: 'Illegal move' });
      return;
    }

    resolveMove(game, player.color, from, to);

    if (game.mode === 'single' && game.status === 'playing' && game.turn === game.botColor) {
      triggerBotMove(gameId);
    }
  });

  socket.on('requestRematch', ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    const player = game.players[socket.id];
    if (!player) return;
    // In single-player the client shows "Play Again" which calls acceptRematch directly
    if (game.mode === 'single') return;
    io.to(gameId).emit('rematchRequested', { by: player.color });
  });

  socket.on('acceptRematch', ({ gameId }) => {
    const oldGame = games[gameId];
    if (!oldGame) return;

    if (oldGame.mode === 'single') {
      // Single-player rematch: swap colors, re-seat bot, auto-select bot king
      const oldHumanColor = oldGame.botColor === 'white' ? 'black' : 'white';
      const newHumanColor = oldGame.botColor;
      const newBotColor = oldHumanColor;

      const newGame = createGame();
      newGame.id = gameId;
      newGame.mode = 'single';
      newGame.difficulty = oldGame.difficulty;
      newGame.botColor = newBotColor;

      const token = uuidv4();
      newGame.tokens[token] = newHumanColor;
      newGame.players[socket.id] = { color: newHumanColor };
      newGame.colors[newHumanColor] = socket.id;
      newGame.colors[newBotColor] = null;

      newGame.trueKings[newBotColor] = selectBotKing(newGame.board, newBotColor);
      newGame.kingSelectionDone[newBotColor] = true;
      newGame.status = 'selecting';
      games[gameId] = newGame;

      socket.emit('rematchStarted', { color: newHumanColor, token });
      socket.emit('gameStart', { message: 'Rematch! Choose your true king.' });
      socket.emit('gameState', getGameState(newGame, newHumanColor));
      return;
    }

    // Multiplayer rematch: swap colors, generate new tokens
    const newGame = createGame();
    newGame.id = gameId;
    const whiteSocketId = oldGame.colors['white'];
    const blackSocketId = oldGame.colors['black'];
    newGame.players[whiteSocketId] = { color: 'black' };
    newGame.players[blackSocketId] = { color: 'white' };
    newGame.colors['white'] = blackSocketId;
    newGame.colors['black'] = whiteSocketId;
    newGame.status = 'selecting';

    const tokenWhite = uuidv4();
    const tokenBlack = uuidv4();
    newGame.tokens[tokenWhite] = 'white';
    newGame.tokens[tokenBlack] = 'black';
    games[gameId] = newGame;

    io.to(newGame.colors['white']).emit('rematchStarted', { color: 'white', token: tokenWhite });
    io.to(newGame.colors['black']).emit('rematchStarted', { color: 'black', token: tokenBlack });
    io.to(gameId).emit('gameStart', { message: 'Rematch! Select your true king.' });
    emitToColor(newGame, 'white', 'gameState', getGameState(newGame, 'white'));
    emitToColor(newGame, 'black', 'gameState', getGameState(newGame, 'black'));
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (const gameId in games) {
      const game = games[gameId];
      if (game.players[socket.id]) {
        const color = game.players[socket.id].color;
        const opponent = color === 'white' ? 'black' : 'white';
        const timerKey = `${gameId}_${color}`;

        // Grace period: give the client 10s to rejoin before notifying opponent
        disconnectTimers[timerKey] = setTimeout(() => {
          delete disconnectTimers[timerKey];
          // Only notify if the player hasn't rejoined (their socket id is still the stale one)
          if (game.colors[color] === socket.id && game.colors[opponent]) {
            io.to(game.colors[opponent]).emit('opponentDisconnected', {
              message: 'Your opponent disconnected.'
            });
          }
        }, 10000);
        break;
      }
    }
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Fog Chess server running on port ${PORT}`));
