// Azure ChaosGuard - Multi-Page Client Controller

const CHAOS_API = 'http://localhost:4000';
const WS_URL = 'ws://localhost:4000';

let ws = null;
let latencyChart = null;
let throughputChart = null;
const MAX_CHART_POINTS = 30;

// Chart Data Buffers
const chartLabels = [];
const p50Data = [];
const p95Data = [];
const p99Data = [];
const okData = [];
const degradedData = [];
const failData = [];

let selectedScenarioId = 'cosmos_429';

const FRIENDLY_NAMES = {
  cosmos_429: 'Database Overload Test',
  brownout: 'Slow Server Network Test',
  pod_crash: 'Server Crash Test',
  poison_pill: 'Bad Data Error Storm',
  multi_region: 'Azure Data Center Outage Test'
};

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initScenarioSelector();
  initCharts();
  initWebSocket();
  initEventListeners();
});

// 1. Clean Multi-Page Navigation System
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const pages = document.querySelectorAll('.page-view');

  const switchPage = (targetPageId) => {
    navItems.forEach(item => {
      if (item.getAttribute('data-page') === targetPageId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    pages.forEach(page => {
      if (page.id === targetPageId) {
        page.classList.add('active');
      } else {
        page.classList.remove('active');
      }
    });

    // Resize charts if switching to overview
    if (targetPageId === 'page-overview' && latencyChart && throughputChart) {
      setTimeout(() => {
        latencyChart.resize();
        throughputChart.resize();
      }, 50);
    }
  };

  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const pageId = btn.getAttribute('data-page');
      switchPage(pageId);
      window.location.hash = pageId.replace('page-', '');
    });
  });

  // Handle URL hash on initial load
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    const pageId = `page-${hash}`;
    if (document.getElementById(pageId)) {
      switchPage(pageId);
    }
  }
}

// 2. Scenario Card Selection in Stress Tests Page
function initScenarioSelector() {
  const scenarioOptions = document.querySelectorAll('.scenario-option');
  scenarioOptions.forEach(card => {
    card.addEventListener('click', () => {
      scenarioOptions.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedScenarioId = card.getAttribute('data-scenario');
    });
  });
}

// 3. Initialize Chart.js
function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.04)' },
        ticks: { color: '#6b7280', font: { family: 'JetBrains Mono', size: 10 } }
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.04)' },
        ticks: { color: '#9ca3af', font: { family: 'JetBrains Mono', size: 10 } }
      }
    }
  };

  const ctxLatency = document.getElementById('latencyChart').getContext('2d');
  latencyChart = new Chart(ctxLatency, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [
        { label: 'Typical', data: p50Data, borderColor: '#06b6d4', borderWidth: 2, tension: 0.3, pointRadius: 0 },
        { label: 'Slower', data: p95Data, borderColor: '#f59e0b', borderWidth: 2, tension: 0.3, pointRadius: 0 },
        { label: 'Max Delay', data: p99Data, borderColor: '#ef4444', borderWidth: 2.5, tension: 0.3, pointRadius: 1 }
      ]
    },
    options: commonOptions
  });

  const ctxThroughput = document.getElementById('throughputChart').getContext('2d');
  throughputChart = new Chart(ctxThroughput, {
    type: 'bar',
    data: {
      labels: chartLabels,
      datasets: [
        { label: '200 OK', data: okData, backgroundColor: 'rgba(16, 185, 129, 0.7)', borderRadius: 4 },
        { label: '202 Degraded', data: degradedData, backgroundColor: 'rgba(245, 158, 11, 0.7)', borderRadius: 4 },
        { label: '5xx Failed', data: failData, backgroundColor: 'rgba(239, 68, 68, 0.85)', borderRadius: 4 }
      ]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        x: { ...commonOptions.scales.x, stacked: true },
        y: { ...commonOptions.scales.y, stacked: true }
      }
    }
  });
}

// 4. WebSocket Client Connection
function initWebSocket() {
  const wsStatusText = document.getElementById('wsStatusText');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsStatusText.innerText = 'Azure Connected Live';
  };

  ws.onclose = () => {
    wsStatusText.innerText = 'Reconnecting...';
    setTimeout(initWebSocket, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleTelemetryTick(data);
    } catch (e) {
      console.error('Telemetry parse error:', e);
    }
  };
}

// 5. Live Telemetry Processing
function handleTelemetryTick(data) {
  const { experiment, traffic, telemetry, finops, baseline, gameday } = data;
  const now = new Date().toLocaleTimeString();

  // Top Header Banner
  const titleEl = document.getElementById('headerTestTitle');
  const timerEl = document.getElementById('headerTimer');
  const pulseDot = document.getElementById('pulseDot');

  if (experiment.status === 'ACTIVE') {
    const friendlyScenario = FRIENDLY_NAMES[experiment.scenario.id] || experiment.scenario.name;
    titleEl.innerText = `${friendlyScenario} (Running)`;
    pulseDot.className = 'pulse-dot active';
    const remaining = Math.max(0, experiment.durationSec - experiment.elapsedSec);
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    timerEl.innerText = `${m}:${s}`;
  } else if (experiment.status === 'COMPLETED') {
    const friendlyScenario = FRIENDLY_NAMES[experiment.scenario.id] || experiment.scenario.name;
    titleEl.innerText = `${friendlyScenario} (Completed - System Healed)`;
    pulseDot.className = 'pulse-dot idle';
    timerEl.innerText = '00:00';
  } else if (experiment.status === 'ABORTED') {
    titleEl.innerText = `STOPPED (All Systems Restored)`;
    pulseDot.className = 'pulse-dot idle';
    timerEl.innerText = '00:00';
  } else {
    titleEl.innerText = 'System Running Normally (No Active Test)';
    pulseDot.className = 'pulse-dot idle';
    timerEl.innerText = '00:00';
  }

  // KPIs
  document.getElementById('kpiRps').innerHTML = `${traffic.isRunning ? traffic.targetRps : 0} <small>orders/sec</small>`;
  document.getElementById('kpiSuccessOrders').innerText = `${traffic.success} Successful`;
  document.getElementById('kpiDegradedOrders').innerText = `${traffic.degraded} Saved by Backup`;

  document.getElementById('kpiP50').innerText = `${traffic.p50}ms`;
  document.getElementById('kpiP95').innerText = `${traffic.p95}ms`;
  document.getElementById('kpiP99').innerHTML = `${traffic.p99} <small>ms</small>`;

  // Safety Shield State
  const cbBadge = document.getElementById('cbBadge');
  const cbText = document.getElementById('cbStateText');
  const rawState = telemetry.circuitState || 'CLOSED';

  let friendlyShieldText = 'NORMAL (All Good)';
  if (rawState === 'OPEN') friendlyShieldText = 'SHIELD ON (Saving Orders via Backup)';
  else if (rawState === 'HALF_OPEN') friendlyShieldText = 'TESTING RECOVERY...';

  cbBadge.className = `shield-badge state-${rawState.toLowerCase().replace('_', '-')}`;
  cbText.innerText = friendlyShieldText;
  document.getElementById('cbTripCount').innerText = `${telemetry.tripCount || 0} times`;
  document.getElementById('cbFallbackCount').innerText = telemetry.fallbackExecutions || traffic.degraded || 0;

  // Cost
  const spendStr = `$${finops.currentSpendUsd.toFixed(2)}`;
  document.getElementById('kpiSpend').innerHTML = `${spendStr} <small>USD</small>`;
  document.getElementById('kpiBurnRate').innerText = `$${finops.burnRatePerMinUsd}/min`;
  document.getElementById('kpiReplicas').innerText = `${finops.autoscaledReplicas} Cloud Servers`;
  document.getElementById('sideSpend').innerText = `Spent: ${spendStr}`;

  // Activity Feed (Page 2)
  if (telemetry.history && telemetry.history.length > 0) {
    const feed = document.getElementById('activityFeed');
    feed.innerHTML = telemetry.history.slice(0, 6).map(h => {
      let friendlyMsg = h.message;
      if (h.event === 'CIRCUIT_OPEN') friendlyMsg = '🛡️ Safety Shield ACTIVATED: Downstream slow. Customer orders routed to backup cache.';
      if (h.event === 'CIRCUIT_CLOSED') friendlyMsg = '✅ Safety Shield RESET: Downstream recovered. Normal speed restored.';
      if (h.event === 'CIRCUIT_HALF_OPEN') friendlyMsg = '🟡 Testing recovery with sample orders...';
      return `
        <div class="activity-item">
          <span class="activity-time">${new Date(h.timestamp).toLocaleTimeString()}</span>
          <span class="activity-text">${friendlyMsg}</span>
        </div>
      `;
    }).join('');
  }

  // Update Charts Buffers
  if (chartLabels.length >= MAX_CHART_POINTS) {
    chartLabels.shift();
    p50Data.shift();
    p95Data.shift();
    p99Data.shift();
    okData.shift();
    degradedData.shift();
    failData.shift();
  }

  chartLabels.push(now);
  p50Data.push(traffic.p50);
  p95Data.push(traffic.p95);
  p99Data.push(traffic.p99);

  okData.push(traffic.success);
  degradedData.push(traffic.degraded);
  failData.push(traffic.failed);

  latencyChart.update();
  throughputChart.update();

  // Scorecard (Page 4)
  if (experiment.scorecard) {
    renderScorecard(experiment.scorecard);
  }

  // GameDay (Page 3)
  renderGameDay(gameday);
}

// 6. Render AI Scorecard & Diff
function renderScorecard(scorecard) {
  document.getElementById('aiScoreNum').innerText = scorecard.compositeScore;
  document.getElementById('aiGradeText').innerText = `Grade: ${scorecard.grade}`;

  document.getElementById('pContainment').innerText = `${scorecard.pillars.containment} / 40`;
  document.getElementById('barContainment').style.width = `${(scorecard.pillars.containment / 40) * 100}%`;

  document.getElementById('pLatency').innerText = `${scorecard.pillars.latency} / 30`;
  document.getElementById('barLatency').style.width = `${(scorecard.pillars.latency / 30) * 100}%`;

  document.getElementById('pRecovery').innerText = `${scorecard.pillars.recovery} / 20`;
  document.getElementById('barRecovery').style.width = `${(scorecard.pillars.recovery / 20) * 100}%`;

  document.getElementById('pIntegrity').innerText = `${scorecard.pillars.integrity} / 10`;
  document.getElementById('barIntegrity').style.width = `${(scorecard.pillars.integrity / 10) * 100}%`;

  if (scorecard.recommendation && scorecard.recommendation.status === 'PR_GENERATED') {
    document.getElementById('aiPrBadge').innerText = `GitHub Pull Request ${scorecard.recommendation.prNumber} Generated`;
    document.getElementById('aiPrSummary').innerText = scorecard.recommendation.summary;
    document.getElementById('aiDiffCode').innerText = scorecard.recommendation.diffPatch;
  }
}

// 7. Render GameDay / Fire Drill
function renderGameDay(gameday) {
  const emptyState = document.getElementById('drillEmptyState');
  const activeState = document.getElementById('drillActiveState');
  const timer = document.getElementById('drillLiveTimer');

  if (gameday.activeDrill) {
    emptyState.style.display = 'none';
    activeState.style.display = 'flex';
    const elapsed = Math.round((Date.now() - gameday.activeDrill.startTime) / 1000);
    timer.innerText = `${elapsed}s`;
  } else {
    emptyState.style.display = 'flex';
    activeState.style.display = 'none';
  }

  const tbody = document.getElementById('leaderboardBody');
  if (gameday.leaderboard) {
    tbody.innerHTML = gameday.leaderboard.map(item => `
      <tr>
        <td><b>${item.team}</b></td>
        <td>${item.mttdSec}s</td>
        <td>${item.mttmSec}s</td>
        <td><span style="color:#34d399;font-weight:700">${item.score} pts</span></td>
      </tr>
    `).join('');
  }
}

// 8. Event Listeners
function initEventListeners() {
  // Start Test Button (Page 2)
  document.getElementById('btnStartTest').addEventListener('click', async () => {
    const rps = document.getElementById('testRps').value;
    const durationSec = document.getElementById('testDuration').value;

    try {
      const res = await fetch(`${CHAOS_API}/api/experiments/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: selectedScenarioId, rps, durationSec })
      });
      const data = await res.json();
      console.log('Test launched:', data);
      
      // Auto-switch to Live Overview to watch the charts
      document.querySelector('.nav-item[data-page="page-overview"]').click();
    } catch (err) {
      alert(`Could not start test: ${err.message}`);
    }
  });

  // Emergency Stop Button
  document.getElementById('btnAbort').addEventListener('click', async () => {
    try {
      const res = await fetch(`${CHAOS_API}/api/experiments/abort`, { method: 'POST' });
      const data = await res.json();
      console.warn('Stopped:', data);
    } catch (err) {
      alert(`Stop failed: ${err.message}`);
    }
  });

  // Fire Drill Controls (Page 3)
  document.getElementById('btnStartGameDay').addEventListener('click', async () => {
    await fetch(`${CHAOS_API}/api/gameday/start`, { method: 'POST' });
  });

  document.getElementById('btnAckDrill').addEventListener('click', async () => {
    await fetch(`${CHAOS_API}/api/gameday/ack`, { method: 'POST' });
  });

  document.getElementById('btnMitigateDrill').addEventListener('click', async () => {
    await fetch(`${CHAOS_API}/api/gameday/mitigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName: 'Live Engineering Team' })
    });
  });
}
