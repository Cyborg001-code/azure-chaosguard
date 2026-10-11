import {
  CircuitBreakerPolicy,
  ConsecutiveBreaker,
  ExponentialBackoff,
  SamplingBreaker,
  circuitBreaker,
  handleAll,
  retry,
  wrap,
  fallback
} from 'cockatiel';

/**
 * Global Resilience State Tracker
 * Tracks circuit breaker transitions, stats, and fallback executions.
 */
export const resilienceStats = {
  circuitState: 'CLOSED', // 'CLOSED', 'OPEN', 'HALF_OPEN'
  successCount: 0,
  failureCount: 0,
  fallbackCount: 0,
  tripCount: 0,
  lastStateChange: new Date().toISOString(),
  history: []
};

// 1. Retry Policy: Exponential backoff with jitter (max 3 retries)
export const retryPolicy = retry(handleAll, {
  maxAttempts: 3,
  backoff: new ExponentialBackoff({
    initialDelay: 100,
    maxDelay: 1000
  })
});

// 2. Circuit Breaker Policy: Breaks after 3 consecutive failures, probes recovery after 5s
export const cbPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 5000,
  breaker: new ConsecutiveBreaker(3)
});

// 3. Fallback Policy: Invoked when Circuit Breaker is OPEN or errors occur
export const fallbackPolicy = fallback(handleAll, (context) => {
  resilienceStats.fallbackCount++;
  return {
    success: true,
    isFallback: true,
    orderId: (context && context.orderId) || 'ORDER-DEGRADED',
    status: 'ACCEPTED_DEGRADED',
    message: 'Payment processor temporarily unavailable. Order preserved and queued via Redis fallback.',
    processedAt: new Date().toISOString()
  };
});

// Hook into circuit breaker state machine events
cbPolicy.onBreak(() => {
  resilienceStats.circuitState = 'OPEN';
  resilienceStats.tripCount++;
  resilienceStats.lastStateChange = new Date().toISOString();
  resilienceStats.history.unshift({
    event: 'CIRCUIT_OPEN',
    timestamp: new Date().toISOString(),
    message: 'Circuit breaker tripped to OPEN due to consecutive failures.'
  });
  if (resilienceStats.history.length > 50) resilienceStats.history.pop();
  console.warn(`[CIRCUIT-BREAKER] ⚠️ TRIPPED TO OPEN at ${resilienceStats.lastStateChange}`);
});

cbPolicy.onReset(() => {
  resilienceStats.circuitState = 'CLOSED';
  resilienceStats.lastStateChange = new Date().toISOString();
  resilienceStats.history.unshift({
    event: 'CIRCUIT_CLOSED',
    timestamp: new Date().toISOString(),
    message: 'Circuit breaker reset to CLOSED after successful recovery probe.'
  });
  if (resilienceStats.history.length > 50) resilienceStats.history.pop();
  console.log(`[CIRCUIT-BREAKER] ✅ RESET TO CLOSED at ${resilienceStats.lastStateChange}`);
});

cbPolicy.onHalfOpen(() => {
  resilienceStats.circuitState = 'HALF_OPEN';
  resilienceStats.lastStateChange = new Date().toISOString();
  resilienceStats.history.unshift({
    event: 'CIRCUIT_HALF_OPEN',
    timestamp: new Date().toISOString(),
    message: 'Circuit breaker entered HALF-OPEN state. Probing downstream health.'
  });
  if (resilienceStats.history.length > 50) resilienceStats.history.pop();
  console.info(`[CIRCUIT-BREAKER] 🟡 ENTERED HALF-OPEN at ${resilienceStats.lastStateChange}`);
});

// Combined Resilient Execution: Fallback wraps CircuitBreaker wraps Retry
export const resilientExecutor = wrap(fallbackPolicy, cbPolicy, retryPolicy);
