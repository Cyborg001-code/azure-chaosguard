import express from 'express';
import cors from 'cors';
import { resilientExecutor, resilienceStats } from '../resilience/circuitBreaker.js';

export const createOrderApp = (paymentServiceUrl = 'http://localhost:5001') => {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // In-memory rolling metrics
  const recentLatencies = [];
  const MAX_LATENCY_SAMPLES = 500;
  let totalOrderRequests = 0;
  let successOrders = 0;
  let degradedOrders = 0;
  let failedOrders = 0;

  // Helper to compute percentiles
  const calculatePercentiles = () => {
    if (recentLatencies.length === 0) return { p50: 0, p95: 0, p99: 0 };
    const sorted = [...recentLatencies].sort((a, b) => a - b);
    const getP = (p) => sorted[Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1)];
    return {
      p50: getP(50),
      p95: getP(95),
      p99: getP(99)
    };
  };

  // Health endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'UP',
      service: 'order-service',
      circuitBreakerState: resilienceStats.circuitState,
      timestamp: new Date().toISOString()
    });
  });

  // Resilience & Telemetry Metrics Endpoint (Polled or Streamed to SignalR/Dashboard)
  app.get('/api/resilience/metrics', (req, res) => {
    const percentiles = calculatePercentiles();
    res.json({
      circuitState: resilienceStats.circuitState,
      tripCount: resilienceStats.tripCount,
      totalRequests: totalOrderRequests,
      successCount: successOrders,
      degradedCount: degradedOrders,
      failedCount: failedOrders,
      fallbackExecutions: resilienceStats.fallbackCount,
      latencies: percentiles,
      recentSamplesCount: recentLatencies.length,
      history: resilienceStats.history.slice(0, 10),
      timestamp: new Date().toISOString()
    });
  });

  // Primary Order Creation Endpoint with Circuit Breaker Protection
  app.post('/api/orders', async (req, res) => {
    totalOrderRequests++;
    const startTime = Date.now();
    const orderId = req.body.orderId || `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const totalAmount = req.body.totalAmount || 99.99;
    const customerId = req.body.customerId || 'CUST-101';

    try {
      // Execute downstream Payment call inside the Resilient Executor
      const paymentResult = await resilientExecutor.execute(async (context) => {
        // Attach order ID to context for fallback visibility
        context.orderId = orderId;

        const response = await fetch(`${paymentServiceUrl}/api/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, amount: totalAmount, customerId })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const err = new Error(`Payment failed with HTTP ${response.status}: ${errorData.message || response.statusText}`);
          err.status = response.status;
          throw err;
        }

        return await response.json();
      });

      const latencyMs = Date.now() - startTime;
      recentLatencies.push(latencyMs);
      if (recentLatencies.length > MAX_LATENCY_SAMPLES) recentLatencies.shift();

      // Check if result was fulfilled via Fallback Policy
      if (paymentResult.isFallback) {
        degradedOrders++;
        return res.status(202).json({
          success: true,
          status: 'ACCEPTED_DEGRADED',
          orderId,
          latencyMs,
          circuitBreakerState: resilienceStats.circuitState,
          note: 'Circuit breaker tripped or payment degraded. Order preserved and queued via Redis fallback.',
          details: paymentResult
        });
      }

      // Normal path success
      successOrders++;
      return res.status(201).json({
        success: true,
        status: 'CONFIRMED',
        orderId,
        latencyMs,
        circuitBreakerState: resilienceStats.circuitState,
        payment: paymentResult
      });
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      recentLatencies.push(latencyMs);
      if (recentLatencies.length > MAX_LATENCY_SAMPLES) recentLatencies.shift();

      failedOrders++;
      return res.status(500).json({
        success: false,
        status: 'FAILED',
        orderId,
        latencyMs,
        circuitBreakerState: resilienceStats.circuitState,
        error: error.message
      });
    }
  });

  return app;
};
