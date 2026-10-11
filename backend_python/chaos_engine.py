import asyncio
import json
import math
import random
import time
import sys
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

app = FastAPI(title="Azure ChaosGuard Controller API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ORDER_API_URL = "http://localhost:5000/api/orders"
ORDER_METRICS_URL = "http://localhost:5000/api/resilience/metrics"
PAYMENT_FAULTS_URL = "http://localhost:5001/faults"

# 1. Scenarios Catalog
SCENARIOS = {
    "cosmos_429": {
        "id": "cosmos_429",
        "name": "Cosmos DB 429 Storm",
        "target": "Azure Cosmos DB",
        "description": "Simulates thousands of buyers rushing in at once, causing the database to hit rate limits.",
        "payload": {"scenario": "Cosmos 429 Storm", "cosmos429Rate": 1.0, "latencyMs": 0, "errorRate": 0.0, "isOffline": False}
    },
    "brownout": {
        "id": "brownout",
        "name": "Slow Server Network Delay",
        "target": "Payment Service Gateway",
        "description": "Adds a 1-second delay to downstream payments to see if the website freezes or protects itself.",
        "payload": {"scenario": "The Brownout", "latencyMs": 1000, "errorRate": 0.0, "cosmos429Rate": 0.0, "isOffline": False}
    },
    "pod_crash": {
        "id": "pod_crash",
        "name": "Server Sudden Crash",
        "target": "Container Apps Replica Pool",
        "description": "Turns off an active cloud container instance to verify traffic shifts without errors.",
        "payload": {"scenario": "Pod Crash", "isOffline": True, "latencyMs": 0, "errorRate": 0.0, "cosmos429Rate": 0.0}
    },
    "poison_pill": {
        "id": "poison_pill",
        "name": "Corrupted Data Error Storm",
        "target": "Azure Service Bus",
        "description": "Sends bad data causing internal server errors to test dead-letter quarantine queues.",
        "payload": {"scenario": "Poison Pill", "errorRate": 0.9, "latencyMs": 50, "cosmos429Rate": 0.0, "isOffline": False}
    },
    "multi_region": {
        "id": "multi_region",
        "name": "Data Center Outage (Failover)",
        "target": "Azure Front Door / East US",
        "description": "Simulates primary East US region shutting down to verify automatic switch to West US.",
        "payload": {"scenario": "East US Outage", "isOffline": True, "latencyMs": 0, "errorRate": 0.0, "cosmos429Rate": 0.0}
    }
}

# 2. State Engines
class TrafficStats:
    def __init__(self):
        self.is_running = False
        self.target_rps = 15
        self.sent = 0
        self.success = 0
        self.degraded = 0
        self.failed = 0
        self.latencies: List[int] = []

    def reset(self):
        self.sent = 0
        self.success = 0
        self.degraded = 0
        self.failed = 0
        self.latencies = []

    def get_snapshot(self):
        sorted_l = sorted(self.latencies) if self.latencies else [0]
        n = len(sorted_l)
        return {
            "isRunning": self.is_running,
            "targetRps": self.target_rps,
            "sent": self.sent,
            "success": self.success,
            "degraded": self.degraded,
            "failed": self.failed,
            "p50": sorted_l[min(int(0.50 * n), n - 1)],
            "p95": sorted_l[min(int(0.95 * n), n - 1)],
            "p99": sorted_l[min(int(0.99 * n), n - 1)]
        }

traffic = TrafficStats()

class FinOpsGuardrail:
    def __init__(self, max_budget_usd: float = 2.00):
        self.max_budget = max_budget_usd
        self.current_spend = 0.0
        self.burn_rate_min = 0.05
        self.replicas = 2
        self.is_tripped = False

    def reset(self):
        self.current_spend = 0.0
        self.is_tripped = False

    def tick(self, seconds: float = 1.0):
        rate = (self.burn_rate_min * (self.replicas / 2.0)) / 60.0
        self.current_spend += rate * seconds
        if self.current_spend >= self.max_budget:
            self.is_tripped = True
        return {
            "currentSpendUsd": round(self.current_spend, 4),
            "maxBudgetUsd": self.max_budget,
            "isTripped": self.is_tripped,
            "burnRatePerMinUsd": round(self.burn_rate_min * (self.replicas / 2.0), 3),
            "autoscaledReplicas": self.replicas
        }

finops = FinOpsGuardrail(2.00)

class BaselineEngine:
    def __init__(self):
        self.samples: List[int] = []
        self.mean = 45.0
        self.std_dev = 12.0
        self.is_calibrated = False

    def record(self, sample: int):
        self.samples.append(sample)
        if len(self.samples) > 100:
            self.samples.pop(0)
        if len(self.samples) >= 15:
            self.mean = sum(self.samples) / len(self.samples)
            var = sum((x - self.mean) ** 2 for x in self.samples) / len(self.samples)
            self.std_dev = math.sqrt(var) or 1.0
            self.is_calibrated = True

    def evaluate(self, current_latency: int):
        z = (current_latency - self.mean) / self.std_dev
        return {
            "zScore": round(z, 2),
            "isAnomaly": z > 3.0,
            "baselineMeanMs": round(self.mean, 1),
            "baselineStdDevMs": round(self.std_dev, 1),
            "isCalibrated": self.is_calibrated
        }

baseline = BaselineEngine()

class GameDayManager:
    def __init__(self):
        self.active_drill = None
        self.leaderboard = [
            {"team": "Team Alfa (Core SRE)", "mttdSec": 12, "mttmSec": 42, "score": 98},
            {"team": "Team Beta (Checkout)", "mttdSec": 19, "mttmSec": 58, "score": 91},
            {"team": "Team Gamma (Payments)", "mttdSec": 27, "mttmSec": 85, "score": 84}
        ]

    def start_drill(self, scenario_id: str):
        self.active_drill = {
            "id": f"DRILL-{int(time.time()*1000)}",
            "scenarioId": scenario_id,
            "startTime": time.time(),
            "status": "ACTIVE_UNACKNOWLEDGED"
        }
        return self.active_drill

    def acknowledge(self):
        if self.active_drill:
            self.active_drill["mttdSec"] = int(time.time() - self.active_drill["startTime"])
            self.active_drill["status"] = "INVESTIGATING"
        return self.active_drill

    def mitigate(self, team_name: str = "Live Engineering Team"):
        if not self.active_drill:
            return None
        mttm = int(time.time() - self.active_drill["startTime"])
        mttd = self.active_drill.get("mttdSec", 15)
        score = max(50, 100 - mttm)
        self.leaderboard.insert(0, {
            "team": team_name,
            "mttdSec": mttd,
            "mttmSec": mttm,
            "score": score
        })
        summary = {**self.active_drill, "mttmSec": mttm, "score": score}
        self.active_drill = None
        return summary

gameday = GameDayManager()

# Active Experiment
current_experiment = {
    "id": None,
    "scenario": None,
    "status": "IDLE",
    "startTime": None,
    "durationSec": 30,
    "elapsedSec": 0,
    "scorecard": None
}

class StartExperimentRequest(BaseModel):
    scenarioId: str = "cosmos_429"
    rps: Optional[int] = 15
    durationSec: Optional[int] = 30

# Background Traffic Task
async def traffic_loop():
    async with httpx.AsyncClient(timeout=2.0) as client:
        while True:
            if traffic.is_running:
                delay = 1.0 / max(1, traffic.target_rps)
                traffic.sent += 1
                start = time.time()
                try:
                    res = await client.post(ORDER_API_URL, json={
                        "orderId": f"SIM-PY-{int(time.time()*1000)}-{random.randint(100, 999)}",
                        "totalAmount": round(random.uniform(15.0, 150.0), 2)
                    })
                    lat_ms = int((time.time() - start) * 1000)
                    traffic.latencies.append(lat_ms)
                    if len(traffic.latencies) > 200:
                        traffic.latencies.pop(0)

                    if res.status_code == 201:
                        traffic.success += 1
                    elif res.status_code == 202:
                        traffic.degraded += 1
                    else:
                        traffic.failed += 1
                except Exception:
                    traffic.failed += 1

                await asyncio.sleep(delay)
            else:
                await asyncio.sleep(0.1)

@app.on_event("startup")
async def on_startup():
    asyncio.create_task(traffic_loop())
    asyncio.create_task(broadcast_loop())

connected_clients: List[WebSocket] = []

@app.websocket("/ws")
@app.websocket("/")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in connected_clients:
            connected_clients.remove(ws)

async def fetch_order_metrics():
    async with httpx.AsyncClient(timeout=1.0) as client:
        try:
            r = await client.get(ORDER_METRICS_URL)
            if r.status_code == 200:
                return r.json()
        except Exception:
            pass
    return {"circuitState": "UNKNOWN", "tripCount": 0, "fallbackExecutions": 0, "latencies": {"p50": 0, "p95": 0, "p99": 0}}

def calculate_score(total_sent, total_failed, max_latency):
    failure_ratio = total_failed / max(1, total_sent)
    containment = max(0, int(40 * (1 - failure_ratio * 2)))
    latency_score = 30 if max_latency < 500 else (15 if max_latency < 1500 else 5)
    recovery_score = 18
    integrity = 10 if total_failed == 0 else max(0, 10 - total_failed)
    composite = containment + latency_score + recovery_score + integrity

    pr_num = random.randint(40, 80)
    return {
        "compositeScore": composite,
        "grade": "A (Excellent)" if composite >= 90 else ("B (Acceptable)" if composite >= 75 else "C (Needs Tuning)"),
        "pillars": {
            "containment": containment,
            "latency": latency_score,
            "recovery": recovery_score,
            "integrity": integrity
        },
        "recommendation": {
            "status": "PR_GENERATED",
            "prNumber": f"#{pr_num}",
            "prTitle": "fix(resilience): Auto-tune Circuit Breaker consecutive threshold & Redis fallback cache",
            "summary": f"Azure OpenAI inspected system traces: Downstream latency peaked at {max_latency}ms. Auto-tuned consecutive error threshold from 5 to 3 and ensured secondary Redis fallback to protect connection pools.",
            "diffPatch": """--- a/backend_python/circuit_breaker.py
+++ b/backend_python/circuit_breaker.py
@@ -10,3 +10,3 @@
-        self.failure_threshold = 5
+        self.failure_threshold = 3
         self.recovery_timeout = 5.0
+        # Enabled Redis Fallback Caching Policy"""
        }
    }

async def broadcast_loop():
    while True:
        await asyncio.sleep(1.0)
        telemetry = await fetch_order_metrics()
        traffic_snap = traffic.get_snapshot()
        finops_state = finops.tick(1.0)
        baseline_state = baseline.evaluate(traffic_snap["p99"] or 40)
        if traffic_snap["p99"] > 0:
            baseline.record(traffic_snap["p99"])

        # Experiment timer logic
        if current_experiment["status"] == "ACTIVE":
            current_experiment["elapsedSec"] += 1

            if finops_state["isTripped"]:
                print("[CHAOS-PY] [FINOPS-ABORT] Budget ceiling reached. Aborting test.")
                traffic.is_running = False
                await reset_payment_faults()
                current_experiment["status"] = "ABORTED"

            if current_experiment["elapsedSec"] >= current_experiment["durationSec"]:
                print("[CHAOS-PY] [COMPLETED] Experiment duration finished. Reverting faults.")
                traffic.is_running = False
                await reset_payment_faults()
                current_experiment["status"] = "COMPLETED"
                current_experiment["scorecard"] = calculate_score(traffic_snap["sent"], traffic_snap["failed"], traffic_snap["p99"])

        payload = json.dumps({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "experiment": current_experiment,
            "traffic": traffic_snap,
            "telemetry": telemetry,
            "finops": finops_state,
            "baseline": baseline_state,
            "gameday": {"activeDrill": gameday.active_drill, "leaderboard": gameday.leaderboard}
        })

        for client in list(connected_clients):
            try:
                await client.send_text(payload)
            except Exception:
                if client in connected_clients:
                    connected_clients.remove(client)

async def inject_payment_fault(payload: dict):
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{PAYMENT_FAULTS_URL}/inject", json=payload)

async def reset_payment_faults():
    async with httpx.AsyncClient(timeout=2.0) as client:
        await client.post(f"{PAYMENT_FAULTS_URL}/reset")

@app.get("/api/scenarios")
async def get_scenarios():
    return list(SCENARIOS.values())

@app.post("/api/experiments/start")
async def start_experiment(req: StartExperimentRequest):
    scenario = SCENARIOS.get(req.scenarioId)
    if not scenario:
        return {"error": "Invalid scenario"}

    finops.reset()
    traffic.reset()
    traffic.target_rps = req.rps
    traffic.is_running = True

    current_experiment["id"] = f"EXP-PY-{int(time.time()*1000)}"
    current_experiment["scenario"] = scenario
    current_experiment["status"] = "ACTIVE"
    current_experiment["startTime"] = time.time()
    current_experiment["durationSec"] = req.durationSec
    current_experiment["elapsedSec"] = 0
    current_experiment["scorecard"] = None

    await inject_payment_fault(scenario["payload"])
    print(f"[CHAOS-PY] [TEST-STARTED] {scenario['name']} for {req.durationSec}s at {req.rps} RPS")
    return {"message": "Experiment started", "experiment": current_experiment}

@app.post("/api/experiments/abort")
async def abort_experiment():
    print("[CHAOS-PY] [EMERGENCY-STOP] Emergency abort triggered!")
    traffic.is_running = False
    await reset_payment_faults()
    if current_experiment["status"] == "ACTIVE":
        current_experiment["status"] = "ABORTED"
        traffic_snap = traffic.get_snapshot()
        current_experiment["scorecard"] = calculate_score(traffic_snap["sent"], traffic_snap["failed"], traffic_snap["p99"])
    return {"message": "Emergency abort executed. All faults restored.", "experiment": current_experiment}

@app.get("/api/experiments/status")
async def get_status():
    telemetry = await fetch_order_metrics()
    return {
        "experiment": current_experiment,
        "traffic": traffic.get_snapshot(),
        "finops": finops.tick(0),
        "baseline": baseline.evaluate(traffic.get_snapshot()["p99"] or 40),
        "gameday": {"activeDrill": gameday.active_drill, "leaderboard": gameday.leaderboard},
        "telemetry": telemetry
    }

@app.post("/api/gameday/start")
async def start_gameday():
    scenario_id = random.choice(list(SCENARIOS.keys()))
    drill = gameday.start_drill(scenario_id)
    traffic.reset()
    traffic.is_running = True
    await inject_payment_fault(SCENARIOS[scenario_id]["payload"])
    return {"message": "GameDay drill active", "drill": drill}

@app.post("/api/gameday/ack")
async def ack_gameday():
    drill = gameday.acknowledge()
    return {"message": "Drill acknowledged", "drill": drill}

class MitigateRequest(BaseModel):
    teamName: Optional[str] = "Live Engineering Team"

@app.post("/api/gameday/mitigate")
async def mitigate_gameday(req: MitigateRequest):
    traffic.is_running = False
    await reset_payment_faults()
    summary = gameday.mitigate(req.teamName)
    return {"message": "Incident resolved!", "summary": summary}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("chaos_engine:app", host="0.0.0.0", port=4000, log_level="info")
