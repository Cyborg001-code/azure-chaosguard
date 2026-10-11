/**
 * Statistical Z-Score Baseline Engine
 * Computes normal distribution baseline (mean & std-dev) to dynamically evaluate anomaly severity.
 */
export class BaselineEngine {
  constructor() {
    this.samples = [];
    this.mean = 45; // Default expected baseline p99 latency (ms)
    this.stdDev = 12; // Default expected std dev (ms)
    this.isCalibrated = false;
  }

  recordSample(latencyMs) {
    this.samples.push(latencyMs);
    if (this.samples.length > 100) this.samples.shift();

    if (this.samples.length >= 20) {
      this._recompute();
    }
  }

  _recompute() {
    const n = this.samples.length;
    this.mean = this.samples.reduce((a, b) => a + b, 0) / n;
    const variance = this.samples.reduce((a, b) => a + Math.pow(b - this.mean, 2), 0) / n;
    this.stdDev = Math.sqrt(variance) || 1;
    this.isCalibrated = true;
  }

  evaluate(currentLatencyMs) {
    const zScore = (currentLatencyMs - this.mean) / this.stdDev;
    return {
      zScore: Number(zScore.toFixed(2)),
      isAnomaly: zScore > 3.0, // 3-sigma rule (99.7% confidence)
      baselineMeanMs: Number(this.mean.toFixed(1)),
      baselineStdDevMs: Number(this.stdDev.toFixed(1)),
      isCalibrated: this.isCalibrated
    };
  }
}
