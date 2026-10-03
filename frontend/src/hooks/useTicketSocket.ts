import { API_BASE, getToken } from '../api';
import { useEffect, useRef } from 'react';

export type SocketMessage =
  | { type: 'ticket_moved';   ticketNumber: string; to: string; by: string }
  | { type: 'ticket_created'; ticketNumber: string; title: string; by: string }
  | { type: 'sla_breach';     ticketNumber: string; title: string }
  | { type: 'comment_added';  ticketNumber: string; by: string }
  | { type: 'ticket_updated'; ticketNumber: string; by: string };

interface Options {
  userId: string;
  onMessage: (msg: SocketMessage) => void;
  /** ms between reconnect attempts, default 3000 */
  reconnectDelay?: number;
}

/**
 * Opens an authenticated WebSocket to the API's /ws endpoint and calls
 * onMessage for each parsed JSON frame. Reconnects automatically on
 * close/error. Silently no-ops if the backend is unreachable.
 */
export function useTicketSocket({ userId, onMessage, reconnectDelay = 3000 }: Options) {
  const wsRef     = useRef<WebSocket | null>(null);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const connect = () => {
      if (!mountedRef.current) return;
      try {
        const token = getToken();
        if (!token) return;
        const ws = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/ws/${encodeURIComponent(userId)}?token=${encodeURIComponent(token)}`);
        wsRef.current = ws;

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data) as SocketMessage;
            onMessage(msg);
          } catch { /* ignore malformed frames */ }
        };

        ws.onclose = (ev) => {
          if (!mountedRef.current || ev.code === 4401) return;
          timerRef.current = setTimeout(connect, reconnectDelay);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        /* Backend unreachable — retry later */
        timerRef.current = setTimeout(connect, reconnectDelay);
      }
    };

    connect();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
