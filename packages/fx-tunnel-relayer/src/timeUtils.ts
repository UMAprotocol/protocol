import { PHASE_LENGTH_SECONDS, SKIP_THRESHOLD_SECONDS } from "./constants";

/**
 * Given a phase length and a Unix-timestamp, returns how many seconds remain
 * until the end of the current phase.
 */
export function secondsUntilRoundEnd(): number {
  const currentTimestampSec: number = Math.floor(Date.now() / 1000);
  const roundIndex = Math.floor(currentTimestampSec / PHASE_LENGTH_SECONDS);
  const nextRoundStart = (roundIndex + 1) * PHASE_LENGTH_SECONDS;
  return nextRoundStart - currentTimestampSec;
}

/**
 * Decide whether we should skip relaying because we’re too close to the
 * round’s end.
 */
export function isTooCloseToRoundEnd(timeRemainingSec: number, thresholdSec: number = SKIP_THRESHOLD_SECONDS): boolean {
  return timeRemainingSec < thresholdSec;
}
