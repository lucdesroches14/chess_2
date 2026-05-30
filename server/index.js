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
  applyMoveWithCastling,
  findTrueKing
} = require('./chessLogic');

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Game rooms storage
const games = {};

function createGame() {
  return {
    id: uuidv4(),
    board: initialBoard(),
    players: {}, // socketId -> { color, trueKingId }
    colors: {}, // color -> socketId
    trueKings: { white: null, black: null },
    kingSelectionDone: { white: false, black: false },
    castlingRights: {
      white: { kingSide: true, queenSide: true },
      black: { kingSide: true, queenSide: true }
    },
    turn: 'white',
    status: 'waiting', // waiting | selecting | playing | finished
    winner: null,
    moveHistory: [],
    capturedPieces: { white: [], black: [] }
  };
}

function getGameState(game, forColor) {
  // Sanitize: never send opponent's true king identity
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
    // Reveal opponent king only when game is finished
    opponentTrueKingId: game.status === 'finished'
      ? game.trueKings[forColor === 'white' ? 'black' : 'white']
      : null
  };
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Create a new game room
  socket.on('createGame', () => {
    const game = createGame();
    games[game.id] = game;
    game.players[socket.id] = { color: 'white' };
    game.colors['white'] = socket.id;
    socket.join(game.id);
    socket.emit('gameCreated', { gameId: game.id, color: 'white' });
    console.log('Game created:', game.id);
  });

  // Join existing game
  socket.on('joinGame', ({ gameId }) => {
    const game = games[gameId];
    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }
    if (Object.keys(game.players).length >= 2) {
      socket.emit('error', { message: 'Game is full' });
      return;
    }
    game.players[socket.id] = { color: 'black' };
    game.colors['black'] = socket.id;
    socket.join(gameId);
    game.status = 'selecting';

    socket.emit('gameJoined', { gameId, color: 'black' });

    // Notify both players to select their kings
    io.to(gameId).emit('gameStart', { message: 'Both players connected. Select your true king.' });
    io.to(game.colors['white']).emit('gameState', getGameState(game, 'white'));
    io.to(game.colors['black']).emit('gameState', getGameState(game, 'black'));
    console.log('Player joined game:', gameId);
  });

  // Player selects their true king
  socket.on('selectKing', ({ gameId, pieceId }) => {
    const game = games[gameId];
    if (!game || game.status !== 'selecting') return;

    const player = game.players[socket.id];
    if (!player) return;

    const color = player.color;
    if (game.kingSelectionDone[color]) return;

    // Validate piece belongs to this player
    let pieceFound = false;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = game.board[r][c];
        if (piece && piece.id === pieceId && piece.color === color) {
          pieceFound = true;
          break;
        }
      }
    }
    if (!pieceFound) {
      socket.emit('error', { message: 'Invalid piece selection' });
      return;
    }

    game.trueKings[color] = pieceId;
    game.kingSelectionDone[color] = true;

    socket.emit('kingSelected', { pieceId });
    console.log(`${color} selected king: ${pieceId}`);

    // If both players have selected, start the game
    if (game.kingSelectionDone.white && game.kingSelectionDone.black) {
      game.status = 'playing';
      io.to(game.colors['white']).emit('gameState', getGameState(game, 'white'));
      io.to(game.colors['black']).emit('gameState', getGameState(game, 'black'));
      io.to(gameId).emit('gameReady', { message: 'Game started! White moves first.' });
    } else {
      // Tell this player to wait
      socket.emit('waitingForOpponent', { message: 'Waiting for opponent to select their king...' });
    }
  });

  // Player requests legal moves for a piece
  socket.on('requestMoves', ({ gameId, row, col }) => {
    const game = games[gameId];
    if (!game || game.status !== 'playing') return;

    const player = game.players[socket.id];
    if (!player || player.color !== game.turn) return;

    const piece = game.board[row][col];
    if (!piece || piece.color !== player.color) return;

    const gameStateForLogic = {
      trueKings: game.trueKings,
      castlingRights: game.castlingRights
    };

    const moves = getLegalMoves(game.board, row, col, gameStateForLogic);
    socket.emit('legalMoves', { moves, from: [row, col] });
  });

  // Player makes a move
  socket.on('makeMove', ({ gameId, from, to, promoteTo }) => {
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

    const gameStateForLogic = {
      trueKings: game.trueKings,
      castlingRights: game.castlingRights
    };

    const legalMoves = getLegalMoves(game.board, from[0], from[1], gameStateForLogic);
    const isLegal = legalMoves.some(([r, c]) => r === to[0] && c === to[1]);

    if (!isLegal) {
      socket.emit('error', { message: 'Illegal move' });
      return;
    }

    // Check if opponent's true king is captured
    const targetPiece = game.board[to[0]][to[1]];
    const opponent = player.color === 'white' ? 'black' : 'white';
    const opponentKingCaptured = targetPiece && targetPiece.id === game.trueKings[opponent];

    // Apply move
    const { newBoard, newCastlingRights } = applyMoveWithCastling(
      game.board, from, to, { ...gameStateForLogic, castlingRights: game.castlingRights }
    );

    // Record move history
    game.moveHistory.push({
      from, to,
      piece: piece.type,
      color: player.color,
      captured: targetPiece ? targetPiece.type : null
    });

    if (targetPiece) {
      game.capturedPieces[player.color].push(targetPiece.type);
    }

    game.board = newBoard;
    game.castlingRights = newCastlingRights;

    // Check win condition: opponent's true king captured
    if (opponentKingCaptured) {
      game.status = 'finished';
      game.winner = player.color;
      io.to(game.colors['white']).emit('gameState', getGameState(game, 'white'));
      io.to(game.colors['black']).emit('gameState', getGameState(game, 'black'));
      io.to(gameId).emit('gameOver', {
        reason: 'capture',
        winner: player.color,
        message: `${player.color === 'white' ? 'White' : 'Black'} Wins!`
      });
      return;
    }

    // Switch turns
    game.turn = opponent;

    const newGameStateForLogic = {
      trueKings: game.trueKings,
      castlingRights: game.castlingRights
    };

    // Check if opponent's true king is now in check
    const opponentInCheck = isTrueKingInCheck(game.board, opponent, game.trueKings[opponent]);

    // Check for checkmate: opponent has no legal moves AND their king is in check
    if (opponentInCheck && isCheckmate(game.board, opponent, newGameStateForLogic)) {
      game.status = 'finished';
      game.winner = player.color;
      io.to(game.colors['white']).emit('gameState', getGameState(game, 'white'));
      io.to(game.colors['black']).emit('gameState', getGameState(game, 'black'));
      io.to(gameId).emit('gameOver', {
        reason: 'checkmate',
        winner: player.color,
        message: `Checkmate - ${player.color === 'white' ? 'White' : 'Black'} Wins!`
      });
      return;
    }

    // Check for stalemate
    if (isStalemate(game.board, opponent, newGameStateForLogic)) {
      game.status = 'finished';
      game.winner = null;
      io.to(game.colors['white']).emit('gameState', getGameState(game, 'white'));
      io.to(game.colors['black']).emit('gameState', getGameState(game, 'black'));
      io.to(gameId).emit('gameOver', {
        reason: 'stalemate',
        winner: null,
        message: 'Stalemate - Draw!'
      });
      return;
    }

    // Send updated state to both players
    io.to(game.colors['white']).emit('gameState', getGameState(game, 'white'));
    io.to(game.colors['black']).emit('gameState', getGameState(game, 'black'));

    // Send private check alert to player in check
    if (opponentInCheck) {
      io.to(game.colors[opponent]).emit('inCheck', {
        message: 'Your king is in check!'
      });
    }
  });

  // Rematch request
  socket.on('requestRematch', ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    const player = game.players[socket.id];
    if (!player) return;
    io.to(gameId).emit('rematchRequested', { by: player.color });
  });

  socket.on('acceptRematch', ({ gameId }) => {
    const oldGame = games[gameId];
    if (!oldGame) return;

    const newGame = createGame();
    newGame.id = gameId; // Keep same room ID
    // Swap colors for rematch
    const whiteSocketId = oldGame.colors['white'];
    const blackSocketId = oldGame.colors['black'];
    newGame.players[whiteSocketId] = { color: 'black' };
    newGame.players[blackSocketId] = { color: 'white' };
    newGame.colors['white'] = blackSocketId;
    newGame.colors['black'] = whiteSocketId;
    newGame.status = 'selecting';
    games[gameId] = newGame;

    io.to(newGame.colors['white']).emit('rematchStarted', { color: 'white' });
    io.to(newGame.colors['black']).emit('rematchStarted', { color: 'black' });
    io.to(gameId).emit('gameStart', { message: 'Rematch! Select your true king.' });
    io.to(newGame.colors['white']).emit('gameState', getGameState(newGame, 'white'));
    io.to(newGame.colors['black']).emit('gameState', getGameState(newGame, 'black'));
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Notify opponent if in a game
    for (const gameId in games) {
      const game = games[gameId];
      if (game.players[socket.id]) {
        const color = game.players[socket.id].color;
        const opponent = color === 'white' ? 'black' : 'white';
        if (game.colors[opponent]) {
          io.to(game.colors[opponent]).emit('opponentDisconnected', {
            message: 'Your opponent disconnected.'
          });
        }
        break;
      }
    }
  });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Fog Chess server running on port ${PORT}`));
