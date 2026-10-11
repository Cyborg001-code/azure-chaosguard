import express from 'express';
import cors from 'cors';

export const createPaymentApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Active Fault Injection Configuration
  const activeFaults = {
    latencyMs: 0,
    errorRate: 0.0, // 0.0 = no errors, 1.0 = 100% errors
    cosmos429Rate: 0.0, // 0.0 = normal, 1.0 = Cosmos DB 429 flood
    isOffline: false,
    injectedAt: null,
    scenarioName: 'NONE'
  };

  // Transaction counter
  let transactionCount = 0;

  // Health check
  app.get('/api/health', (req, res) => {
    if (activeFaults.isOffline) {
      return res.status(503).json({ status: 'DOWN', error: 'Payment service simulated offline' });
    }
    res.json({
      status: 'UP',
      service: 'payment-service',
      activeFaults,
      transactionCount,
      timestamp: new Date().toISOString()
    });
  });

  // Chaos Injection API (Invoked by Chaos Controller Engine)
  app.post('/faults/inject', (req, res) => {
    const { scenario, latencyMs, errorRate, cosmos429Rate, isOffline } = req.body;
    activeFaults.scenarioName = scenario || 'CUSTOM';
    activeFaults.latencyMs = Number(latencyMs) || 0;
    activeFaults.errorRate = Number(errorRate) || 0;
    activeFaults.cosmos429Rate = Number(cosmos429Rate) || 0;
    activeFaults.isOffline = Boolean(isOffline);
    activeFaults.injectedAt = new Date().toISOString();

    console.warn(`[PAYMENT-SERVICE] 🚨 FAULT INJECTED: Scenario=${activeFaults.scenarioName}, Latency=${activeFaults.latencyMs}ms, ErrorRate=${activeFaults.errorRate}, Cosmos429=${activeFaults.cosmos429Rate}`);
    res.json({ message: 'Fault active', activeFaults });
  });

  // Emergency Reset / Heal API
  app.post('/faults/reset', (req, res) => {
    activeFaults.latencyMs = 0;
    activeFaults.errorRate = 0;
    activeFaults.cosmos429Rate = 0;
    activeFaults.isOffline = false;
    activeFaults.scenarioName = 'NONE';
    activeFaults.injectedAt = null;

    console.log('[PAYMENT-SERVICE] 🛡️ FAULTS CLEARED: Returned to healthy state');
    res.json({ message: 'All faults cleared', activeFaults });
  });

  app.get('/faults/status', (req, res) => {
    res.json(activeFaults);
  });

  // Payment Processing Endpoint
  app.post('/api/pay', async (req, res) => {
    transactionCount++;
    const { orderId, amount, customerId } = req.body;

    // 1. Check Offline
    if (activeFaults.isOffline) {
      return res.status(503).json({
        error: 'ServiceUnavailable',
        message: 'Payment processor is completely offline.'
      });
    }

    // 2. Inject Latency if configured
    if (activeFaults.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, activeFaults.latencyMs));
    }

    // 3. Inject Cosmos DB 429 Throttling
    if (activeFaults.cosmos429Rate > 0 && Math.random() < activeFaults.cosmos429Rate) {
      return res.status(429).json({
        error: 'RequestRateTooLarge',
        message: 'Cosmos DB Request Units (RU/s) exceeded. HTTP 429 Substatus: 3200.',
        retryAfterMs: 500
      });
    }

    // 4. Inject Generic Dependency Failure (500)
    if (activeFaults.errorRate > 0 && Math.random() < activeFaults.errorRate) {
      return res.status(500).json({
        error: 'InternalPaymentGatewayError',
        message: 'Downstream payment clearinghouse timeout or internal failure.'
      });
    }

    // Success response
    res.status(200).json({
      success: true,
      transactionId: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId,
      amount,
      status: 'PAID',
      processedAt: new Date().toISOString()
    });
  });

  return app;
};
