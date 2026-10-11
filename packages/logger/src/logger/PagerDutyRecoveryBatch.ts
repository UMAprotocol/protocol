import type { Logger } from "winston";
import { resolvePagerDutyIncident } from "./Logger";

/** Collect confirmed recovery while doing useful work; reconcile notifications after the batch. */
export class PagerDutyRecoveryBatch {
  private readonly keys = new Set<string>();

  constructor(private readonly logger: Logger, private readonly at: string) {}

  add(key: string): void {
    this.keys.add(key);
  }

  async flush(): Promise<void> {
    for (const key of this.keys) {
      try {
        await resolvePagerDutyIncident(this.logger, key);
        this.keys.delete(key);
      } catch (error) {
        // Do not spend a network timeout on every historical success during a PagerDuty outage.
        // Callers can queue confirmed keys again on later scans; never resolve unconfirmed or unseen work.
        this.logger.warn({ at: this.at, message: "Deferring remaining incident recovery notifications", error });
        return;
      }
    }
  }
}
