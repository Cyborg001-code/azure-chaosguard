/**
 * Traffic Generator Module
 * Generates synthetic baseline transaction load against the Order Service.
 */
export class TrafficGenerator {
  constructor(targetUrl = 'http://localhost:5000/api/orders') {
    this.targetUrl = targetUrl;
    this.isRunning = false;
    this.targetRps = 10;
    this.intervalId = null;
    this.stats = {
      sent: 0,
      success: 0,
      degraded: 0,
      failed: 0,
      recentLatencies: []
    };
  }

  start(rps = 10) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.targetRps = rps;
    this.stats = { sent: 0, success: 0, degraded: 0, failed: 0, recentLatencies: [] };

    const intervalMs = Math.max(10, Math.floor(1000 / this.targetRps));
    this.intervalId = setInterval(() => this._sendRequest(), intervalMs);
    console.log(`[TRAFFIC-GEN] 🚀 Started synthetic load at ~${this.targetRps} RPS`);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    console.log('[TRAFFIC-GEN] 🛑 Stopped synthetic load');
  }

  async _sendRequest() {
    if (!this.isRunning) return;
    this.stats.sent++;
    const start = Date.now();
    try {
      const response = await fetch(this.targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: `SIM-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          totalAmount: (Math.random() * 100 + 10).toFixed(2),
          customerId: `SIM-USER-${Math.floor(Math.random() * 50)}`
        })
      });

      const latency = Date.now() - start;
      this.stats.recentLatencies.push(latency);
      if (this.stats.recentLatencies.length > 200) this.stats.recentLatencies.shift();

      if (response.status === 201) {
        this.stats.success++;
      } else if (response.status === 202) {
        this.stats.degraded++;
      } else {
        this.stats.failed++;
      }
    } catch (err) {
      this.stats.failed++;
    }
  }

  getSnapshot() {
    const latencies = [...this.stats.recentLatencies].sort((a, b) => a - b);
    const getP = (p) => latencies.length ? latencies[Math.min(Math.floor((p / 100) * latencies.length), latencies.length - 1)] : 0;
    return {
      isRunning: this.isRunning,
      targetRps: this.targetRps,
      sent: this.stats.sent,
      success: this.stats.success,
      degraded: this.stats.degraded,
      failed: this.stats.failed,
      p50: getP(50),
      p95: getP(95),
      p99: getP(99)
    };
  }
}
