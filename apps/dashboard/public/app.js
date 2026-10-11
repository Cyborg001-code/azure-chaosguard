// Azure ChaosGuard - Multi-Page Client Controller

const CHAOS_API = 'http://localhost:4000';
const WS_URL = 'ws://localhost:4000';

let ws = null;
let latencyChart = null;
let throughputChart = null;
let costDoughnutChart = null;
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
  multi_region: 'Azure Data Center Outage Test',
  cascading_timeout: 'Cascading Timeout Domino Test'
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

    // Resize charts if switching to overview or cost page
    if (targetPageId === 'page-overview' && latencyChart && throughputChart) {
      setTimeout(() => {
        latencyChart.resize();
        throughputChart.resize();
      }, 50);
    } else if (targetPageId === 'page-cost' && costDoughnutChart) {
      setTimeout(() => {
        costDoughnutChart.resize();
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

  // Cost Doughnut Chart
  const ctxCost = document.getElementById('costDoughnutChart').getContext('2d');
  costDoughnutChart = new Chart(ctxCost, {
    type: 'doughnut',
    data: {
      labels: ['Azure Cosmos DB', 'Azure Container Apps', 'Azure Redis Cache', 'SignalR & App Insights'],
      datasets: [{
        data: [47, 30, 15, 8],
        backgroundColor: ['#ef4444', '#06b6d4', '#f59e0b', '#10b981'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      cutout: '72%'
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
  const { experiment, traffic, telemetry, finops, baseline, gameday, azureAccount } = data;
  const now = new Date().toLocaleTimeString();

  // Sidebar Azure Account Status
  if (azureAccount) {
    const wsText = document.getElementById('wsStatusText');
    if (wsText) {
      if (azureAccount.isLive) {
        wsText.innerText = `Azure Cloud: Live (${azureAccount.authMethod})`;
        wsText.title = `Connected to Subscription: ${azureAccount.subscriptionId}`;
      } else {
        wsText.innerText = 'Azure: Simulation Mode';
        wsText.title = 'Local simulation active. Fill in .env.azure or run az login to connect your real Azure account.';
      }
    }
  }

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

  // Cost Analyzer (Page: Cloud Cost Analyzer)
  if (data.cost) {
    renderCostAnalyzer(data.cost);
  }

  // Multi-Region Failover Visualizer (Page 1)
  if (data.multiRegion) {
    renderMultiRegion(data.multiRegion);
  }

  // GameDay (Page 3)
  renderGameDay(gameday);
}

// 6. FinOps Cost Analyzer
const SERVICE_COLORS = {
  cosmos_db: '#ef4444',
  container_apps: '#06b6d4',
  redis_cache: '#f59e0b',
  telemetry: '#10b981'
};

function renderCostAnalyzer(cost) {
  if (!cost) return;

  // 1. Top KPI Summary Cards
  const totalSpendEl = document.getElementById('costTotalSpend');
  if (totalSpendEl) totalSpendEl.innerHTML = `$${cost.totalSpendUsd.toFixed(2)} <small>USD</small>`;

  const highestNameEl = document.getElementById('costHighestName');
  if (highestNameEl && cost.highestCostService) {
    highestNameEl.innerText = `${cost.highestCostService.icon} ${cost.highestCostService.name}`;
  }

  const highestPctEl = document.getElementById('costHighestPct');
  if (highestPctEl && cost.highestCostService) {
    highestPctEl.innerText = `${cost.highestCostService.percentage}% of Total Bill`;
  }

  const savingsEl = document.getElementById('costSavings');
  if (savingsEl) {
    savingsEl.innerHTML = `$${cost.shieldSavingsUsd.toFixed(2)} <small>Saved</small>`;
  }

  const monthlyEl = document.getElementById('costMonthly');
  if (monthlyEl) {
    monthlyEl.innerHTML = `$${Math.round(cost.projectedMonthlyUsd)} <small>/ month</small>`;
  }

  const burnRateEl = document.getElementById('costBurnRate');
  if (burnRateEl) {
    burnRateEl.innerText = `$${cost.burnRatePerMinUsd}/min`;
  }

  // 2. Update Doughnut Chart
  if (costDoughnutChart && cost.breakdown && cost.breakdown.length > 0) {
    costDoughnutChart.data.labels = cost.breakdown.map(b => b.name);
    costDoughnutChart.data.datasets[0].data = cost.breakdown.map(b => Math.max(1, b.percentage));
    costDoughnutChart.data.datasets[0].backgroundColor = cost.breakdown.map(b => SERVICE_COLORS[b.id] || '#6b7280');
    costDoughnutChart.update();
  }

  // 3. Update Chart Legend
  const legendList = document.getElementById('costLegendList');
  if (legendList && cost.breakdown) {
    legendList.innerHTML = cost.breakdown.map(item => `
      <div class="cost-legend-item">
        <div class="cost-legend-left">
          <span class="cost-legend-color" style="background: ${SERVICE_COLORS[item.id] || '#6b7280'};"></span>
          <span>${item.icon} ${item.name}</span>
        </div>
        <b>${item.percentage}% ($${item.spend.toFixed(2)})</b>
      </div>
    `).join('');
  }

  // 4. Update Ranked Service List
  const servicesList = document.getElementById('servicesCostList');
  if (servicesList && cost.breakdown) {
    servicesList.innerHTML = cost.breakdown.map((item, index) => {
      const rank = index + 1;
      const isHighest = rank === 1;
      const barColor = SERVICE_COLORS[item.id] || '#06b6d4';
      return `
        <div class="service-cost-item rank-${rank}">
          <div class="service-cost-top">
            <div class="service-name-group">
              <span class="service-rank-badge">#${rank}</span>
              <span class="service-icon-small">${item.icon}</span>
              <span class="service-title">${item.name}</span>
              <span class="service-tier-tag">${item.tier}</span>
            </div>
            <div class="service-spend-group">
              <span class="service-spend-val">$${item.spend.toFixed(4)}</span>
              <span class="service-pct-pill ${isHighest ? 'highest' : 'normal'}">${item.percentage}% share</span>
            </div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.max(4, item.percentage)}%; background: ${barColor};"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 5. Dynamic FinOps Tip
  const tipEl = document.getElementById('finopsTipText');
  if (tipEl && cost.highestCostService) {
    tipEl.innerHTML = `<b>${cost.highestCostService.name}</b> accounts for the highest cloud cost (<b>${cost.highestCostService.percentage}%</b> of your bill) due to serverless RU/s bursts under traffic surges. Enabling the <b>Safety Shield</b> routes requests to Azure Redis Cache, saving approximately <b>$${cost.shieldSavingsUsd.toFixed(2)} USD</b> and preventing runaway database charges.`;
  }
}

// 7. Multi-Region Real-Time Traffic & Failover Visualizer
function renderMultiRegion(mr) {
  if (!mr || !mr.regions) return;

  const { eastUs, westUs } = mr.regions;
  const isFailover = mr.frontDoor.routingState === 'EMERGENCY_FAILOVER_ACTIVE';

  // 1. Top Routing Badge
  const badgeEl = document.getElementById('routingBadge');
  const badgeTextEl = document.getElementById('routingBadgeText');
  if (badgeEl && badgeTextEl) {
    if (isFailover) {
      badgeEl.className = 'routing-badge failover';
      badgeTextEl.innerText = '🚨 EMERGENCY FAILOVER ACTIVE (West US Serving 100%)';
    } else {
      badgeEl.className = 'routing-badge normal';
      badgeTextEl.innerText = 'Normal Routing (East US Active)';
    }
  }

  // 2. Region 1 (East US)
  const eastBox = document.getElementById('regionEastBox');
  const eastStatus = document.getElementById('regionEastStatus');
  const eastRole = document.getElementById('regionEastRole');
  const eastTraffic = document.getElementById('regionEastTraffic');
  const eastLatency = document.getElementById('regionEastLatency');
  const eastProbe = document.getElementById('regionEastProbe');

  if (eastBox && eastStatus) {
    if (eastUs.isHealthy) {
      eastBox.className = 'region-box active';
      eastStatus.className = 'status-pill healthy';
      eastStatus.innerText = 'HEALTHY';
      eastRole.innerText = eastUs.role;
      eastLatency.innerText = `${eastUs.latencyMs} ms`;
      eastProbe.innerText = eastUs.probeStatus;
    } else {
      eastBox.className = 'region-box down';
      eastStatus.className = 'status-pill down';
      eastStatus.innerText = 'OUTAGE DETECTED';
      eastRole.innerText = 'Primary (DOWN)';
      eastLatency.innerText = 'Timeout (503)';
      eastProbe.innerText = eastUs.probeStatus;
    }
    eastTraffic.innerText = `${eastUs.trafficPct}%`;
  }

  // 3. Region 2 (West US)
  const westBox = document.getElementById('regionWestBox');
  const westStatus = document.getElementById('regionWestStatus');
  const westRole = document.getElementById('regionWestRole');
  const westTraffic = document.getElementById('regionWestTraffic');
  const westLatency = document.getElementById('regionWestLatency');
  const westProbe = document.getElementById('regionWestProbe');

  if (westBox && westStatus) {
    if (isFailover || westUs.trafficPct > 0) {
      westBox.className = 'region-box active';
      westStatus.className = 'status-pill healthy';
      westStatus.innerText = 'ACTIVE (REROUTED)';
      westRole.innerText = 'Failover Region (ACTIVE)';
    } else {
      westBox.className = 'region-box standby';
      westStatus.className = 'status-pill standby';
      westStatus.innerText = 'STANDBY READY';
      westRole.innerText = westUs.role;
    }
    westTraffic.innerText = `${westUs.trafficPct}%`;
    westLatency.innerText = `${westUs.latencyMs} ms`;
    westProbe.innerText = westUs.probeStatus;
  }

  // 4. Center Split Bar
  const fillEast = document.getElementById('splitFillEast');
  const fillWest = document.getElementById('splitFillWest');
  const labelEast = document.getElementById('splitEastLabel');
  const labelWest = document.getElementById('splitWestLabel');
  const speedText = document.getElementById('failoverSpeedText');

  if (fillEast && fillWest) {
    fillEast.style.width = `${eastUs.trafficPct}%`;
    fillWest.style.width = `${westUs.trafficPct}%`;
  }
  if (labelEast && labelWest) {
    labelEast.innerText = `East US: ${eastUs.trafficPct}%`;
    labelWest.innerText = `West US: ${westUs.trafficPct}%`;
  }
  if (speedText && isFailover) {
    speedText.innerText = `Rerouted in ${mr.frontDoor.failoverTimeSec}s (0 Sessions Lost)`;
  } else if (speedText) {
    speedText.innerText = 'Zero Loss Rerouting (< 2.4s)';
  }
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
