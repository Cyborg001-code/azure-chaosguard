/**
 * Chaos Scenarios Definitions & Target Actuators
 */
export const SCENARIOS = {
  cosmos_429: {
    id: 'cosmos_429',
    name: 'Cosmos DB 429 Storm',
    target: 'Azure Cosmos DB',
    description: 'Forces HTTP 429 (RequestRateTooLarge) RU exhaustion on database queries.',
    payload: { scenario: 'Cosmos 429 Storm', cosmos429Rate: 1.0, latencyMs: 0, errorRate: 0, isOffline: false }
  },
  brownout: {
    id: 'brownout',
    name: 'The Brownout (Latency Injection)',
    target: 'Payment Service Gateway',
    description: 'Injects 1000ms delay into payment processing to test circuit breaker trip speed.',
    payload: { scenario: 'The Brownout', latencyMs: 1000, errorRate: 0, cosmos429Rate: 0, isOffline: false }
  },
  pod_crash: {
    id: 'pod_crash',
    name: 'Pod Crash & Flapping',
    target: 'Container Apps Replica Pool',
    description: 'Simulates microservice crash resulting in HTTP 503 unavailability.',
    payload: { scenario: 'Pod Crash', isOffline: true, latencyMs: 0, errorRate: 0, cosmos429Rate: 0 }
  },
  poison_pill: {
    id: 'poison_pill',
    name: 'Service Bus Poison Pill',
    target: 'Azure Service Bus',
    description: 'Injects downstream internal gateway errors (HTTP 500) to test DLQ routing.',
    payload: { scenario: 'Poison Pill', errorRate: 0.9, latencyMs: 50, cosmos429Rate: 0, isOffline: false }
  },
  multi_region: {
    id: 'multi_region',
    name: 'Multi-Region Outage & Failover',
    target: 'Azure Front Door / East US',
    description: 'Simulates complete primary region blackout and monitors traffic shift to West US secondary.',
    payload: { scenario: 'East US Outage', isOffline: true, latencyMs: 0, errorRate: 0, cosmos429Rate: 0 }
  }
};

export class ScenarioActuator {
  constructor(paymentFaultUrl = 'http://localhost:5001/faults') {
    this.paymentFaultUrl = paymentFaultUrl;
  }

  async inject(scenarioId) {
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);

    const res = await fetch(`${this.paymentFaultUrl}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scenario.payload)
    });
    if (!res.ok) throw new Error(`Fault injection failed: ${res.statusText}`);
    return await res.json();
  }

  async reset() {
    const res = await fetch(`${this.paymentFaultUrl}/reset`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error(`Fault reset failed: ${res.statusText}`);
    return await res.json();
  }
}
