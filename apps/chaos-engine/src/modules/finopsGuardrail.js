/**
 * FinOps Spend Guardrail Module
 * Monitors simulated cloud infrastructure cost and enforces budget ceilings.
 */
export class FinOpsGuardrail {
  constructor(maxBudgetUsd = 2.00) {
    this.maxBudgetUsd = maxBudgetUsd;
    this.currentSpendUsd = 0.00;
    this.burnRatePerMinUsd = 0.05; // Standard staging burn rate
    this.autoscaledReplicas = 2;
    this.isTripped = false;
  }

  reset() {
    this.currentSpendUsd = 0.00;
    this.autoscaledReplicas = 2;
    this.isTripped = false;
  }

  tick(seconds = 1) {
    // Under load / autoscaling, burn rate increases
    const scaledRate = (this.burnRatePerMinUsd * (this.autoscaledReplicas / 2)) / 60;
    this.currentSpendUsd += scaledRate * seconds;

    if (this.currentSpendUsd >= this.maxBudgetUsd) {
      this.isTripped = true;
    }

    return {
      currentSpendUsd: Number(this.currentSpendUsd.toFixed(4)),
      maxBudgetUsd: this.maxBudgetUsd,
      isTripped: this.isTripped,
      burnRatePerMinUsd: Number((this.burnRatePerMinUsd * (this.autoscaledReplicas / 2)).toFixed(3)),
      autoscaledReplicas: this.autoscaledReplicas
    };
  }

  simulateAutoscaleSurge() {
    this.autoscaledReplicas = Math.min(10, this.autoscaledReplicas + 2);
  }
}
