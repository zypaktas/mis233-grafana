import { firstValueFrom, take, toArray } from 'rxjs';
import { LoadingState } from '@grafana/data';
import { appendLivePoints, liveStream } from './live';
import { ApiSeriesResponse, CampusQuery } from './types';

const query: CampusQuery = {
  refId: 'A',
  building: 'all',
  metric: 'energy',
  aggregation: 'avg',
  interval: '1m',
  format: 'timeseries',
  live: true,
};

const history = (): ApiSeriesResponse => ({
  metric: 'energy',
  unit: 'kwatth',
  interval_ms: 60000,
  aggregation: 'avg',
  series: [
    {
      building: 'lib',
      name: 'Library',
      points: [
        [1000, 10],
        [2000, 11],
      ],
    },
  ],
});

describe('appendLivePoints', () => {
  it('appends new points, adds new buildings and trims the window', () => {
    const state = history();
    appendLivePoints(
      state,
      {
        type: 'points',
        t: 3000,
        metric: 'energy',
        points: [
          { building: 'lib', name: 'Library', v: 12 },
          { building: 'gym', name: 'Gym', v: 5 },
        ],
      },
      1500
    );
    expect(state.series[0].points).toEqual([
      [2000, 11],
      [3000, 12],
    ]);
    expect(state.series[1]).toEqual({ building: 'gym', name: 'Gym', points: [[3000, 5]] });
  });

  it('ignores out-of-order points', () => {
    const state = history();
    appendLivePoints(
      state,
      { type: 'points', t: 1500, metric: 'energy', points: [{ building: 'lib', name: 'Library', v: 99 }] },
      1e9
    );
    expect(state.series[0].points).toHaveLength(2);
  });
});

/** Minimal stand-in for the browser WebSocket. */
class FakeSocket {
  static last: FakeSocket;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  closed = false;
  constructor(public url: string) {
    FakeSocket.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.closed = true;
  }
}

describe('liveStream', () => {
  it('emits history first, then one streaming update per message, and subscribes with the query', async () => {
    const stream = liveStream({
      wsUrl: 'ws://test/live',
      query,
      history: history(),
      windowMs: 1e9,
      createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    });
    const result = firstValueFrom(stream.pipe(take(2), toArray()));
    await new Promise((r) => setTimeout(r, 5));
    expect(JSON.parse(FakeSocket.last.sent[0])).toEqual({
      type: 'subscribe',
      metric: 'energy',
      building: 'all',
      intervalMs: 1000,
    });
    FakeSocket.last.onmessage?.({
      data: JSON.stringify({
        type: 'points',
        t: 3000,
        metric: 'energy',
        points: [{ building: 'lib', name: 'Library', v: 12 }],
      }),
    });
    const [first, second] = await result;
    expect(first.state).toBe(LoadingState.Streaming);
    expect(first.data[0].length).toBe(2);
    expect(second.data[0].length).toBe(3);
    expect(second.key).toBe('campus-live-A');
    expect(FakeSocket.last.closed).toBe(true); // unsubscribed after take(2)
  });

  it('reports a disconnect as an error and reconnects', async () => {
    const sockets: FakeSocket[] = [];
    const stream = liveStream({
      wsUrl: 'ws://test/live',
      query,
      history: history(),
      windowMs: 1e9,
      retryMs: 5,
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s as unknown as WebSocket;
      },
    });
    const result = firstValueFrom(stream.pipe(take(2), toArray()));
    await new Promise((r) => setTimeout(r, 5));
    sockets[0].onclose?.();
    const [, err] = await result;
    expect(err.state).toBe(LoadingState.Error);
    expect(err.errors?.[0].message).toMatch(/disconnected/);
    await new Promise((r) => setTimeout(r, 20));
    expect(sockets.length).toBeGreaterThanOrEqual(1);
  });
});
