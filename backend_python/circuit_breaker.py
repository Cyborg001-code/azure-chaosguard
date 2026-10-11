import time
from datetime import datetime, timezone
from typing import Callable, Any, Dict, List

class CircuitBreaker:
    """
    Python Implementation of Enterprise Circuit Breaker & Fallback Policy.
    States: CLOSED -> OPEN -> HALF_OPEN -> CLOSED
    """
    def __init__(self, failure_threshold: int = 3, recovery_timeout: float = 5.0):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.state = "CLOSED"
        self.consecutive_failures = 0
        self.last_failure_time = 0.0
        self.trip_count = 0
        self.fallback_count = 0
        self.history: List[Dict[str, Any]] = []

    def _record_event(self, event_type: str, message: str):
        self.history.insert(0, {
            "event": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "message": message
        })
        if len(self.history) > 50:
            self.history.pop()

    async def execute(self, func: Callable, fallback_func: Callable, *args, **kwargs) -> Any:
        now = time.time()

        # Check if circuit is OPEN and cooldown period has expired (transition to HALF_OPEN)
        if self.state == "OPEN":
            if now - self.last_failure_time >= self.recovery_timeout:
                self.state = "HALF_OPEN"
                self._record_event("CIRCUIT_HALF_OPEN", "Circuit breaker entered HALF-OPEN state. Probing downstream health.")
                print("[CIRCUIT-BREAKER-PY] 🟡 ENTERED HALF-OPEN: Testing downstream recovery.")
            else:
                # Still OPEN: Immediately invoke fallback in 0ms!
                self.fallback_count += 1
                return await fallback_func(*args, **kwargs)

        try:
            # Execute primary operation
            result = await func(*args, **kwargs)

            # Success path: If in HALF_OPEN, reset to CLOSED
            if self.state == "HALF_OPEN":
                self.state = "CLOSED"
                self.consecutive_failures = 0
                self._record_event("CIRCUIT_CLOSED", "Circuit breaker reset to CLOSED after successful recovery probe.")
                print("[CIRCUIT-BREAKER-PY] ✅ RESET TO CLOSED: Full recovery verified.")
            else:
                self.consecutive_failures = 0

            return result

        except Exception as err:
            self.consecutive_failures += 1
            self.last_failure_time = time.time()

            # Check if failures exceeded threshold
            if self.consecutive_failures >= self.failure_threshold:
                if self.state != "OPEN":
                    self.state = "OPEN"
                    self.trip_count += 1
                    self._record_event("CIRCUIT_OPEN", f"Circuit breaker tripped to OPEN due to {self.consecutive_failures} consecutive failures.")
                    print(f"[CIRCUIT-BREAKER-PY] ⚠️ TRIPPED TO OPEN: Downstream failing. Shield activated.")

            # Invoke fallback policy gracefully
            self.fallback_count += 1
            return await fallback_func(*args, **kwargs)

    def get_metrics(self) -> Dict[str, Any]:
        return {
            "circuitState": self.state,
            "consecutiveFailures": self.consecutive_failures,
            "tripCount": self.trip_count,
            "fallbackCount": self.fallback_count,
            "history": self.history[:10]
        }
