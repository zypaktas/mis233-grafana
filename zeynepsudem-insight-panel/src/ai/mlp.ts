/**
 * A very small multi-layer perceptron (one hidden tanh layer, linear output) trained
 * with mini-batch Adam. Written from scratch in TypeScript so the panel has no ML
 * dependency and everything runs inside the browser, on the data Grafana gives the panel.
 */

/** Deterministic pseudo random numbers (mulberry32), so training is reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrainOptions {
  epochs: number;
  learningRate: number;
  batchSize: number;
  /** L2 weight decay. */
  l2: number;
  seed: number;
}

export const DEFAULT_TRAIN: TrainOptions = { epochs: 60, learningRate: 0.01, batchSize: 32, l2: 1e-4, seed: 233 };

export class MLP {
  readonly inputs: number;
  readonly hidden: number;
  // weights
  w1: Float64Array; // hidden x inputs
  b1: Float64Array; // hidden
  w2: Float64Array; // hidden
  b2 = 0;

  constructor(inputs: number, hidden: number, seed = 233) {
    this.inputs = inputs;
    this.hidden = hidden;
    const rnd = seededRandom(seed);
    const scale1 = Math.sqrt(1 / inputs);
    const scale2 = Math.sqrt(1 / hidden);
    this.w1 = Float64Array.from({ length: hidden * inputs }, () => (rnd() * 2 - 1) * scale1);
    this.b1 = new Float64Array(hidden);
    this.w2 = Float64Array.from({ length: hidden }, () => (rnd() * 2 - 1) * scale2);
  }

  predict(x: ArrayLike<number>): number {
    let out = this.b2;
    for (let h = 0; h < this.hidden; h++) {
      let z = this.b1[h];
      const row = h * this.inputs;
      for (let i = 0; i < this.inputs; i++) {
        z += this.w1[row + i] * x[i];
      }
      out += this.w2[h] * Math.tanh(z);
    }
    return out;
  }

  /** Trains on (X, y) with mean squared error. Returns the loss after each epoch. */
  train(X: number[][], y: number[], opts: Partial<TrainOptions> = {}): number[] {
    const o = { ...DEFAULT_TRAIN, ...opts };
    const n = X.length;
    if (n === 0) {
      return [];
    }
    const rnd = seededRandom(o.seed + 1);
    const params = [this.w1, this.b1, this.w2];
    const m = params.map((p) => new Float64Array(p.length));
    const v = params.map((p) => new Float64Array(p.length));
    let mB2 = 0;
    let vB2 = 0;
    const beta1 = 0.9;
    const beta2 = 0.999;
    const eps = 1e-8;
    let step = 0;

    const g1 = new Float64Array(this.w1.length);
    const gb1 = new Float64Array(this.b1.length);
    const g2 = new Float64Array(this.w2.length);
    const act = new Float64Array(this.hidden);
    const order = Array.from({ length: n }, (_, i) => i);
    const losses: number[] = [];

    for (let epoch = 0; epoch < o.epochs; epoch++) {
      // shuffle (Fisher–Yates)
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      let epochLoss = 0;
      for (let start = 0; start < n; start += o.batchSize) {
        const end = Math.min(n, start + o.batchSize);
        g1.fill(0);
        gb1.fill(0);
        g2.fill(0);
        let gB2 = 0;
        for (let k = start; k < end; k++) {
          const x = X[order[k]];
          // forward
          let out = this.b2;
          for (let h = 0; h < this.hidden; h++) {
            let z = this.b1[h];
            const row = h * this.inputs;
            for (let i = 0; i < this.inputs; i++) {
              z += this.w1[row + i] * x[i];
            }
            act[h] = Math.tanh(z);
            out += this.w2[h] * act[h];
          }
          const err = out - y[order[k]];
          epochLoss += err * err;
          // backward
          gB2 += err;
          for (let h = 0; h < this.hidden; h++) {
            g2[h] += err * act[h];
            const dz = err * this.w2[h] * (1 - act[h] * act[h]);
            gb1[h] += dz;
            const row = h * this.inputs;
            for (let i = 0; i < this.inputs; i++) {
              g1[row + i] += dz * x[i];
            }
          }
        }
        const bs = end - start;
        step++;
        const lrT = (o.learningRate * Math.sqrt(1 - Math.pow(beta2, step))) / (1 - Math.pow(beta1, step));
        const grads = [g1, gb1, g2];
        for (let p = 0; p < params.length; p++) {
          const P = params[p];
          const G = grads[p];
          for (let i = 0; i < P.length; i++) {
            const g = G[i] / bs + (p !== 1 ? o.l2 * P[i] : 0);
            m[p][i] = beta1 * m[p][i] + (1 - beta1) * g;
            v[p][i] = beta2 * v[p][i] + (1 - beta2) * g * g;
            P[i] -= (lrT * m[p][i]) / (Math.sqrt(v[p][i]) + eps);
          }
        }
        const gb = gB2 / bs;
        mB2 = beta1 * mB2 + (1 - beta1) * gb;
        vB2 = beta2 * vB2 + (1 - beta2) * gb * gb;
        this.b2 -= (lrT * mB2) / (Math.sqrt(vB2) + eps);
      }
      losses.push(epochLoss / n);
    }
    return losses;
  }
}
