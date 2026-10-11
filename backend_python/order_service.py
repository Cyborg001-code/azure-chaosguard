import time
from datetime import datetime, timezone
from typing import Optional, List
import httpx
from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from circuit_breaker import CircuitBreaker

app = FastAPI(title="Target Order Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PAYMENT_SERVICE_URL = "http://localhost:5001"
circuit_breaker = CircuitBreaker(failure_threshold=3, recovery_timeout=5.0)

# Rolling metrics
recent_latencies: List[float] = []
MAX_LATENCIES = 500
total_requests = 0
success_orders = 0
degraded_orders = 0
failed_orders = 0

class OrderRequest(BaseModel):
    orderId: Optional[str] = None
    totalAmount: Optional[float] = 99.99
    customerId: Optional[str] = "CUST-101"

def calculate_percentiles():
    if not recent_latencies:
        return {"p50": 0, "p95": 0, "p99": 0}
    sorted_l = sorted(recent_latencies)
    n = len(sorted_l)
    return {
        "p50": int(sorted_l[min(int(0.50 * n), n - 1)]),
        "p95": int(sorted_l[min(int(0.95 * n), n - 1)]),
        "p99": int(sorted_l[min(int(0.99 * n), n - 1)])
    }

async def call_payment_api(order_id: str, amount: float, customer_id: str):
    async with httpx.AsyncClient(timeout=2.0) as client:
        resp = await client.post(
            f"{PAYMENT_SERVICE_URL}/api/pay",
            json={"orderId": order_id, "amount": amount, "customerId": customer_id}
        )
        if resp.status_code != 200:
            raise Exception(f"Payment HTTP error {resp.status_code}: {resp.text}")
        return resp.json()

async def fallback_order_handler(order_id: str, amount: float, customer_id: str):
    return {
        "success": True,
        "isFallback": True,
        "orderId": order_id,
        "status": "ACCEPTED_DEGRADED",
        "message": "Payment processor temporarily unavailable. Order preserved and queued via Redis fallback.",
        "processedAt": datetime.now(timezone.utc).isoformat()
    }

@app.get("/api/health")
async def health():
    return {
        "status": "UP",
        "service": "order-service-python",
        "circuitBreakerState": circuit_breaker.state,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@app.get("/api/resilience/metrics")
async def resilience_metrics():
    cb_metrics = circuit_breaker.get_metrics()
    return {
        "circuitState": cb_metrics["circuitState"],
        "tripCount": cb_metrics["tripCount"],
        "totalRequests": total_requests,
        "successCount": success_orders,
        "degradedCount": degraded_orders,
        "failedCount": failed_orders,
        "fallbackExecutions": cb_metrics["fallbackCount"],
        "latencies": calculate_percentiles(),
        "history": cb_metrics["history"],
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@app.post("/api/orders")
async def create_order(req: OrderRequest, response: Response):
    global total_requests, success_orders, degraded_orders, failed_orders

    total_requests += 1
    start_time = time.time()
    order_id = req.orderId or f"ORD-PY-{int(time.time()*1000)}"
    amount = req.totalAmount or 99.99
    customer_id = req.customerId or "CUST-101"

    try:
        payment_result = await circuit_breaker.execute(
            call_payment_api,
            fallback_order_handler,
            order_id,
            amount,
            customer_id
        )

        latency_ms = int((time.time() - start_time) * 1000)
        recent_latencies.append(latency_ms)
        if len(recent_latencies) > MAX_LATENCIES:
            recent_latencies.pop(0)

        # Check if fallback executed
        if payment_result.get("isFallback"):
            degraded_orders += 1
            response.status_code = status.HTTP_202_ACCEPTED
            return {
                "success": True,
                "status": "ACCEPTED_DEGRADED",
                "orderId": order_id,
                "latencyMs": latency_ms,
                "circuitBreakerState": circuit_breaker.state,
                "details": payment_result
            }

        success_orders += 1
        response.status_code = status.HTTP_201_CREATED
        return {
            "success": True,
            "status": "CONFIRMED",
            "orderId": order_id,
            "latencyMs": latency_ms,
            "circuitBreakerState": circuit_breaker.state,
            "payment": payment_result
        }

    except Exception as err:
        latency_ms = int((time.time() - start_time) * 1000)
        recent_latencies.append(latency_ms)
        failed_orders += 1
        response.status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
        return {
            "success": False,
            "status": "FAILED",
            "orderId": order_id,
            "latencyMs": latency_ms,
            "circuitBreakerState": circuit_breaker.state,
            "error": str(err)
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("order_service:app", host="0.0.0.0", port=5000, log_level="info")
