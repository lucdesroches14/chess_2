import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3001';

export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // Attempt to resume any in-progress game after every (re)connect
      try {
        const raw = sessionStorage.getItem('chessSession');
        if (raw) {
          const { gameId, token } = JSON.parse(raw);
          if (gameId && token) socket.emit('rejoinGame', { gameId, token });
        }
      } catch (_) {}
    });

    socket.on('disconnect', () => setConnected(false));

    // When the app returns to the foreground after being backgrounded,
    // reconnect the socket if it dropped while the screen was off.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        socket.connect();
      }
    };
    const handlePageShow = () => {
      if (!socket.connected) socket.connect();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      socket.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  const emit = useCallback((event, data) => {
    if (socketRef.current) socketRef.current.emit(event, data);
  }, []);

  const on = useCallback((event, handler) => {
    if (socketRef.current) socketRef.current.on(event, handler);
    return () => { if (socketRef.current) socketRef.current.off(event, handler); };
  }, []);

  const off = useCallback((event, handler) => {
    if (socketRef.current) socketRef.current.off(event, handler);
  }, []);

  return { socket: socketRef.current, connected, emit, on, off };
}
