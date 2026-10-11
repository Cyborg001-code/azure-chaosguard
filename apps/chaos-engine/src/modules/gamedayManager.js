/**
 * GameDay SRE Team Simulator Manager
 * Measures Mean Time to Detect (MTTD) and Mean Time to Mitigate (MTTM) during simulated drills.
 */
export class GameDayManager {
  constructor() {
    this.activeDrill = null;
    this.leaderboard = [
      { team: 'Team Alfa (Core SRE)', mttdSec: 12, mttmSec: 42, score: 98 },
      { team: 'Team Beta (Checkout)', mttdSec: 19, mttmSec: 58, score: 91 },
      { team: 'Team Gamma (Payments)', mttdSec: 27, mttmSec: 85, score: 84 }
    ];
  }

  startDrill(mysteryScenarioId) {
    this.activeDrill = {
      id: `DRILL-${Date.now()}`,
      scenarioId: mysteryScenarioId,
      startTime: Date.now(),
      acknowledgedTime: null,
      mitigatedTime: null,
      mttdSec: null,
      mttmSec: null,
      status: 'ACTIVE_UNACKNOWLEDGED'
    };
    return this.activeDrill;
  }

  acknowledgeDrill() {
    if (!this.activeDrill || this.activeDrill.acknowledgedTime) return this.activeDrill;
    this.activeDrill.acknowledgedTime = Date.now();
    this.activeDrill.mttdSec = Math.round((this.activeDrill.acknowledgedTime - this.activeDrill.startTime) / 1000);
    this.activeDrill.status = 'ACKNOWLEDGED_INVESTIGATING';
    return this.activeDrill;
  }

  mitigateDrill(teamName = 'Current Team') {
    if (!this.activeDrill) return null;
    this.activeDrill.mitigatedTime = Date.now();
    this.activeDrill.mttmSec = Math.round((this.activeDrill.mitigatedTime - this.activeDrill.startTime) / 1000);
    this.activeDrill.status = 'RESOLVED';

    const drillSummary = { ...this.activeDrill };
    this.leaderboard.push({
      team: teamName,
      mttdSec: drillSummary.mttdSec || 15,
      mttmSec: drillSummary.mttmSec,
      score: Math.max(50, 100 - drillSummary.mttmSec)
    });
    this.leaderboard.sort((a, b) => b.score - a.score);
    this.activeDrill = null;
    return drillSummary;
  }

  getStatus() {
    return {
      activeDrill: this.activeDrill,
      leaderboard: this.leaderboard
    };
  }
}
