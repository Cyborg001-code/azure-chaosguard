import asyncio
import random
import time
import sys
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

try:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

app = FastAPI(title="Target Payment Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active Fault Injection State
active_faults = {
    "latencyMs": 0,
    "errorRate": 0.0,
    "cosmos429Rate": 0.0,
    "isOffline": False,
    "injectedAt": None,
    "scenarioName": "NONE"
}

transaction_count = 0

class PaymentRequest(BaseModel):
    orderId: str
    amount: float
    customerId: Optional[str] = "CUST-101"

class FaultInjectionRequest(BaseModel):
    scenario: Optional[str] = "CUSTOM"
    latencyMs: Optional[int] = 0
    errorRate: Optional[float] = 0.0
    cosmos429Rate: Optional[float] = 0.0
    isOffline: Optional[bool] = False

@app.get("/api/health")
async def health():
    if active_faults["isOffline"]:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payment service simulated offline"
        )
    return {
        "status": "UP",
        "service": "payment-service-python",
        "activeFaults": active_faults,
        "transactionCount": transaction_count,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@app.post("/faults/inject")
async def inject_faults(req: FaultInjectionRequest):
    active_faults["scenarioName"] = req.scenario or "CUSTOM"
    active_faults["latencyMs"] = req.latencyMs or 0
    active_faults["errorRate"] = req.errorRate or 0.0
    active_faults["cosmos429Rate"] = req.cosmos429Rate or 0.0
    active_faults["isOffline"] = req.isOffline or False
    active_faults["injectedAt"] = datetime.now(timezone.utc).isoformat()
    print(f"[PAYMENT-PY] [FAULT-INJECTED] Scenario={active_faults['scenarioName']}, Latency={active_faults['latencyMs']}ms, 429Rate={active_faults['cosmos429Rate']}")
    return {"message": "Fault active", "activeFaults": active_faults}

@app.post("/faults/reset")
async def reset_faults():
    active_faults["latencyMs"] = 0
    active_faults["errorRate"] = 0.0
    active_faults["cosmos429Rate"] = 0.0
    active_faults["isOffline"] = False
    active_faults["scenarioName"] = "NONE"
    active_faults["injectedAt"] = None
    print("[PAYMENT-PY] [FAULTS-CLEARED] Clean healthy state restored")
    return {"message": "All faults cleared", "activeFaults": active_faults}

@app.get("/faults/status")
async def fault_status():
    return active_faults

@app.post("/api/pay")
async def process_payment(req: PaymentRequest):
    global transaction_count
    transaction_count += 1

    # 1. Offline check
    if active_faults["isOffline"]:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payment processor is completely offline."
        )

    # 2. Injected Latency
    if active_faults["latencyMs"] > 0:
        await asyncio.sleep(active_faults["latencyMs"] / 1000.0)

    # 3. Cosmos DB 429 Throttling
    if active_faults["cosmos429Rate"] > 0 and random.random() < active_faults["cosmos429Rate"]:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Cosmos DB Request Units (RU/s) exceeded. HTTP 429 Substatus: 3200."
        )

    # 4. Injected Gateway 500 error
    if active_faults["errorRate"] > 0 and random.random() < active_faults["errorRate"]:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Downstream payment clearinghouse timeout or internal error."
        )

    return {
        "success": True,
        "transactionId": f"TX-PY-{int(time.time()*1000)}-{random.randint(100, 999)}",
        "orderId": req.orderId,
        "amount": req.amount,
        "status": "PAID",
        "processedAt": datetime.now(timezone.utc).isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("payment_service:app", host="0.0.0.0", port=5001, log_level="info")
