import { useEffect, useRef, useCallback } from 'react';
import type { WSEvent } from '../types';

type Handler     = (event: WSEvent) => void;
type ReconnectFn = () => void;

export function useWebSocket(onEvent: Handler, onReconnect?: ReconnectFn) {
  const handlerRef   = useRef<Handler>(onEvent);
  const reconnectRef = useRef<ReconnectFn | undefined>(onReconnect);
  const wsRef        = useRef<WebSocket | null>(null);
  const retryRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef   = useRef(true);
  const everConnected = useRef(false);

  handlerRef.current   = onEvent;
  reconnectRef.current = onReconnect;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${location.hostname}${location.port ? `:${location.port}` : ''}/ws`;
    const ws  = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (everConnected.current) reconnectRef.current?.();   // re-fetch on reconnect
      everConnected.current = true;
    };
    ws.onmessage = (e) => {
      try { handlerRef.current(JSON.parse(e.data) as WSEvent); }
      catch { /* ignore */ }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      retryRef.current = setTimeout(connect, 2_000);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
