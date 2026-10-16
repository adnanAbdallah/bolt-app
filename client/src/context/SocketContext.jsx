import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';

const SocketContext = createContext({ socket: null, connected: false });

/** One authenticated Socket.IO connection per signed-in user (the auth cookie rides along). */
export function SocketProvider({ children }) {
  const { user, setUser } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return undefined;
    const s = io({ withCredentials: true });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('user:updated', ({ user: updated }) => setUser(updated));
    s.on('account:banned', () => location.assign('/login?error=account_banned'));
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
      setConnected(false);
    };
  }, [userId, setUser]);

  return <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);

/** Subscribe to a server event for the lifetime of the component. */
export function useSocketEvent(event, handler) {
  const { socket } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    const fn = (payload) => ref.current(payload);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [socket, event]);
}

/** Run `fn` whenever the socket (re)connects, to catch up on anything missed while offline. */
export function useOnReconnect(fn) {
  const { socket } = useSocket();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!socket) return undefined;
    const h = () => ref.current();
    socket.io.on('reconnect', h);
    return () => socket.io.off('reconnect', h);
  }, [socket]);
}
