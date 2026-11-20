import { MLP, seededRandom } from './mlp';

describe('MLP', () => {
  it('is deterministic for a given seed', () => {
    const a = new MLP(3, 4, 42);
    const b = new MLP(3, 4, 42);
    expect(a.predict([0.1, 0.2, 0.3])).toBe(b.predict([0.1, 0.2, 0.3]));
    const r1 = seededRandom(1);
    const r2 = seededRandom(1);
    expect([r1(), r1()]).toEqual([r2(), r2()]);
  });

  it('learns a simple non-linear function', () => {
    const rnd = seededRandom(5);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 400; i++) {
      const a = rnd() * 2 - 1;
      const b = rnd() * 2 - 1;
      X.push([a, b]);
      y.push(Math.sin(2 * a) + 0.5 * b);
    }
    const net = new MLP(2, 12, 3);
    const losses = net.train(X, y, { epochs: 150, learningRate: 0.02 });
    expect(losses[losses.length - 1]).toBeLessThan(losses[0] / 10);
    expect(Math.abs(net.predict([0.5, 0.2]) - (Math.sin(1) + 0.1))).toBeLessThan(0.15);
  });
});
