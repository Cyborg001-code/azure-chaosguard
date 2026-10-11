import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { TrafficGenerator } from './modules/trafficGenerator.js';
import { ScenarioActuator, SCENARIOS } from './modules/scenarios.js';
import { FinOpsGuardrail } from './modules/finopsGuardrail.js';
import { BaselineEngine } from './modules/baselineEngine.js';
import { ResilienceEvaluator } from './modules/resilienceEvaluator.js';
import { GameDayManager } from './modules/gamedayManager.js';

const PORT = process.env.CHAOS_PORT || 4000;
const ORDER_METRICS_URL = process.env.ORDER_METRICS_URL || 'http://localhost:5000/api/resilience/metrics';

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Instantiate Modules
const trafficGen = new TrafficGenerator();
const actuator = new ScenarioActuator();
const finops = new FinOpsGuardrail(2.00);
const baseline = new BaselineEngine();
const evaluator = new ResilienceEvaluator();
const gameday = new GameDayManager();

// Active Experiment State
let currentExperiment = {
  id: null,
  scenario: null,
  status: 'IDLE', // 'IDLE', 'WARMUP', 'ACTIVE', 'ABORTED', 'COMPLETED'
  startTime: null,
  durationSec: 30,
  elapsedSec: 0,
  scorecard: null
};

// 1. List Scenarios
app.get('/api/scenarios', (req, res) => {
  res.json(Object.values(SCENARIOS));
});

// 2. Start Chaos Experiment
app.post('/api/experiments/start', async (req, res) => {
  const { scenarioId = 'cosmos_429', rps = 15, durationSec = 30 } = req.body;
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) return res.status(400).json({ error: 'Invalid scenarioId' });

  // Reset FinOps & Experiment state
  finops.reset();
  currentExperiment = {
    id: `EXP-${Date.now()}`,
    scenario,
    status: 'ACTIVE',
    startTime: Date.now(),
    durationSec: Number(durationSec) || 30,
    elapsedSec: 0,
    scorecard: null
  };

  try {
    // Start traffic generator
    trafficGen.start(Number(rps) || 15);
    // Inject fault into target services
    await actuator.inject(scenarioId);

    console.log(`[CHAOS-ENGINE] ⚡ Launched experiment: ${scenario.name} (Duration: ${currentExperiment.durationSec}s, RPS: ${rps})`);
    res.json({ message: 'Experiment started', experiment: currentExperiment });
  } catch (err) {
    trafficGen.stop();
    res.status(500).json({ error: err.message });
  }
});

// 3. Emergency Abort / Kill Switch
app.post('/api/experiments/abort', async (req, res) => {
  console.warn('[CHAOS-ENGINE] 🛑 EMERGENCY ABORT TRIGGERED!');
  trafficGen.stop();
  await actuator.reset().catch(() => {});

  if (currentExperiment.status === 'ACTIVE') {
    currentExperiment.status = 'ABORTED';
    const trafficSnapshot = trafficGen.getSnapshot();
    currentExperiment.scorecard = evaluator.calculateScore({
      totalSent: trafficSnapshot.sent,
      totalFailed: trafficSnapshot.failed,
      totalDegraded: trafficSnapshot.degraded,
      maxLatencyMs: trafficSnapshot.p99,
      rtoSeconds: currentExperiment.elapsedSec
    });
  }

  res.json({ message: 'Emergency abort executed. All faults restored.', experiment: currentExperiment });
});

// 4. Status API
app.get('/api/experiments/status', async (req, res) => {
  const telemetry = await fetchOrderMetrics();
  res.json({
    experiment: currentExperiment,
    traffic: trafficGen.getSnapshot(),
    finops: finops.tick(0),
    baseline: baseline.evaluate(telemetry.latencies?.p99 || 40),
    gameday: gameday.getStatus(),
    telemetry
  });
});

// 5. GameDay APIs
app.post('/api/gameday/start', async (req, res) => {
  const scenarioKeys = Object.keys(SCENARIOS);
  const randomScenarioId = scenarioKeys[Math.floor(Math.random() * scenarioKeys.length)];
  const drill = gameday.startDrill(randomScenarioId);

  trafficGen.start(10);
  await actuator.inject(randomScenarioId).catch(() => {});
  res.json({ message: 'GameDay Drill Started. Mystery fault injected.', drill });
});

app.post('/api/gameday/ack', (req, res) => {
  const drill = gameday.acknowledgeDrill();
  res.json({ message: 'Incident acknowledged.', drill });
});

app.post('/api/gameday/mitigate', async (req, res) => {
  const { teamName } = req.body;
  trafficGen.stop();
  await actuator.reset().catch(() => {});
  const summary = gameday.mitigateDrill(teamName || 'Ops Vanguard');
  res.json({ message: 'Incident resolved!', summary });
});

// Helper to pull order metrics
async function fetchOrderMetrics() {
  try {
    const r = await fetch(ORDER_METRICS_URL);
    if (r.ok) return await r.json();
  } catch (e) {}
  return { circuitState: 'UNKNOWN', latencies: { p50: 0, p95: 0, p99: 0 }, tripCount: 0 };
}

// 6. Broadcast Real-time Telemetry Loop via WebSockets (1-second tick)
setInterval(async () => {
  const telemetry = await fetchOrderMetrics();
  const traffic = trafficGen.getSnapshot();
  const finopsState = finops.tick(1);
  const baselineState = baseline.evaluate(telemetry.latencies?.p99 || 40);

  if (traffic.p99 > 0) baseline.recordSample(traffic.p99);

  // Experiment progression logic
  if (currentExperiment.status === 'ACTIVE') {
    currentExperiment.elapsedSec++;

    // Check FinOps spend ceiling
    if (finopsState.isTripped) {
      console.warn('[CHAOS-ENGINE] 💰 FinOps Spend ceiling reached! Auto-aborting.');
      trafficGen.stop();
      await actuator.reset().catch(() => {});
      currentExperiment.status = 'ABORTED';
    }

    // Check Completion
    if (currentExperiment.elapsedSec >= currentExperiment.durationSec) {
      console.log('[CHAOS-ENGINE] ✅ Experiment time completed. Reverting faults.');
      await actuator.reset().catch(() => {});
      trafficGen.stop();
      currentExperiment.status = 'COMPLETED';
      currentExperiment.scorecard = evaluator.calculateScore({
        totalSent: traffic.sent,
        totalFailed: traffic.failed,
        totalDegraded: traffic.degraded,
        maxLatencyMs: traffic.p99,
        rtoSeconds: currentExperiment.elapsedSec
      });
    }
  }

  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    experiment: currentExperiment,
    traffic,
    telemetry,
    finops: finopsState,
    baseline: baselineState,
    gameday: gameday.getStatus()
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}, 1000);

server.listen(PORT, () => {
  console.log(`🎮 [CHAOS-ENGINE] Controller API running on port ${PORT}`);
  console.log(`   └─ WebSocket Broadcast: ws://localhost:${PORT}`);
  console.log(`   └─ Experiments API: http://localhost:${PORT}/api/experiments/status`);
});
