import { useEffect, useRef } from 'react';

export type SocketMessage =
  | { type: 'ticket_moved';   ticketNumber: string; to: string; by: string }
  | { type: 'ticket_created'; ticketNumber: string; title: string; by: string }
  | { type: 'sla_breach';     ticketNumber: string; title: string }
  | { type: 'comment_added';  ticketNumber: string; by: string };

interface Options {
  userId: string;
  onMessage: (msg: SocketMessage) => void;
  /** ms between reconnect attempts, default 3000 */
  reconnectDelay?: number;
}

/**
 * Opens a WebSocket to ws://127.0.0.1:8000/ws/{userId} and calls
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
        const ws = new WebSocket(`ws://127.0.0.1:8000/ws/${encodeURIComponent(userId)}`);
        wsRef.current = ws;

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data) as SocketMessage;
            onMessage(msg);
          } catch { /* ignore malformed frames */ }
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
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
