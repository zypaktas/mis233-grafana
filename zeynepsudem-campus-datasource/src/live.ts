import { DataQueryResponse, LoadingState } from '@grafana/data';
import { Observable } from 'rxjs';
import { ApiSeriesResponse, CampusQuery } from './types';
import { seriesToFrames } from './convert';

/** Message the Campus API sends every interval on ws://…/live */
export interface LivePointsMessage {
  type: 'points';
  t: number;
  metric: string;
  points: Array<{ building: string; name: string; v: number }>;
}

type ServerMessage =
  | LivePointsMessage
  | { type: 'hello' | 'subscribed' | 'unsubscribed' }
  | { type: 'error'; message: string };

export interface LiveOptions {
  wsUrl: string;
  query: CampusQuery;
  /** Points loaded over REST before the stream starts. */
  history: ApiSeriesResponse;
  /** Width of the sliding window in ms (the dashboard time range). */
  windowMs: number;
  /** Factory so tests can inject a fake socket. */
  createSocket?: (url: string) => WebSocket;
  /** Reconnect delay, doubled after each failure up to 30 s. */
  retryMs?: number;
}

/**
 * Appends one live message to the series, creating a series for a building we have
 * not seen yet, and drops points that fell out of the sliding window.
 * Pure function: easy to unit test.
 */
export function appendLivePoints(state: ApiSeriesResponse, msg: LivePointsMessage, windowMs: number): ApiSeriesResponse {
  const cutoff = msg.t - windowMs;
  for (const p of msg.points) {
    let s = state.series.find((x) => x.building === p.building);
    if (!s) {
      s = { building: p.building, name: p.name, points: [] };
      state.series.push(s);
    }
    const last = s.points[s.points.length - 1];
    if (!last || msg.t > last[0]) {
      s.points.push([msg.t, p.v]);
    }
    let drop = 0;
    while (drop < s.points.length && s.points[drop][0] < cutoff) {
      drop++;
    }
    if (drop > 0) {
      s.points.splice(0, drop);
    }
  }
  return state;
}

/**
 * Streams a query: first the REST history, then one update per WebSocket message.
 * The observable emits `LoadingState.Streaming` responses with a stable `key`, which
 * tells Grafana to replace the previous frames for this query instead of adding them.
 * The socket reconnects with exponential back-off and closes when the panel unsubscribes.
 */
export function liveStream(opts: LiveOptions): Observable<DataQueryResponse> {
  const { query, windowMs } = opts;
  const key = `campus-live-${query.refId}`;
  const create = opts.createSocket ?? ((url: string) => new WebSocket(url));

  return new Observable<DataQueryResponse>((subscriber) => {
    const state: ApiSeriesResponse = {
      ...opts.history,
      series: opts.history.series.map((s) => ({ ...s, points: [...s.points] })),
    };
    let socket: WebSocket | undefined;
    let closed = false;
    let retry = opts.retryMs ?? 2000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const emit = (error?: string) =>
      subscriber.next({
        key,
        state: error ? LoadingState.Error : LoadingState.Streaming,
        data: seriesToFrames(state, query),
        errors: error ? [{ refId: query.refId, message: error }] : undefined,
      });

    const connect = () => {
      if (closed) {
        return;
      }
      try {
        socket = create(opts.wsUrl);
      } catch (err) {
        emit(`Invalid WebSocket URL "${opts.wsUrl}": ${(err as Error).message}`);
        return;
      }
      socket.onopen = () => {
        retry = opts.retryMs ?? 2000;
        socket!.send(JSON.stringify({ type: 'subscribe', metric: query.metric, building: query.building, intervalMs: 1000 }));
      };
      socket.onmessage = (event: MessageEvent) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.type === 'points') {
          appendLivePoints(state, msg, windowMs);
          emit();
        } else if (msg.type === 'error') {
          emit(`Live stream error: ${msg.message}`);
        }
      };
      socket.onclose = () => {
        if (closed) {
          return;
        }
        emit(`Live stream disconnected from ${opts.wsUrl}. Reconnecting in ${Math.round(retry / 1000)} s…`);
        retryTimer = setTimeout(connect, retry);
        retry = Math.min(30000, retry * 2);
      };
      socket.onerror = () => {
        // onclose follows and handles the retry
      };
    };

    emit();
    connect();

    return () => {
      closed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      socket?.close();
    };
  });
}
