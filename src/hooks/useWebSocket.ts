import { useEffect, useRef, useCallback } from 'react';
import type { WSEvent } from '../types';

type Handler     = (event: WSEvent) => void;
type ReconnectFn = () => void;

/**
 * Maintains a WebSocket connection with automatic reconnect.
 * Also dispatches a 'vs:ws' custom DOM event for components (like SettingsPanel)
 * that need WS data but can't receive it via prop drilling.
 */
export function useWebSocket(onEvent: Handler, onReconnect?: ReconnectFn) {
  const handlerRef    = useRef<Handler>(onEvent);
  const reconnectRef  = useRef<ReconnectFn | undefined>(onReconnect);
  const wsRef         = useRef<WebSocket | null>(null);
  const retryRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef    = useRef(true);
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
      if (everConnected.current) reconnectRef.current?.();
      everConnected.current = true;
    };

    ws.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as WSEvent;

        // Dispatch to App component
        handlerRef.current(parsed);

        // Also broadcast on the DOM so isolated components (SettingsPanel, etc.)
        // can subscribe without prop drilling
        window.dispatchEvent(new CustomEvent('vs:ws', { detail: parsed }));
      } catch { /* ignore malformed */ }
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
