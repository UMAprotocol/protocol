const { VotePhasesEnum } = require("../../../../common/Enums");
const moment = require("moment");
const SECONDS_IN_DAY = 86400;
const MINUTES_IN_HOUR = 60;

/**
 * Returns the time remaining until the next vote phase and round, broken down
 * conveniently into full hours and minutes. It is simply a convenience method.
 *
 * For example: If the contract time is Feb 7 2020, 8:04:53 PM, then this method will return
 * that there are 3 hours and 55 minutes remaining until midnight when the next phase begins.
 * If this is a Commit phase, then there will be 27 hours and 55 minutes until the next round begins because
 * a full round is a Commit followed by a Reveal phase. If this is a Reveal phase, there will simply be 3 hours and 55 minutes
 * until the next round.
 *
 * @param {* String} contractTime What time the contract thinks it is, in seconds
 * @param {* String} roundPhase 0 = Commit or 1 = Reveal
 */
const votePhaseTiming = (contractTime, roundPhase) => {
  // Phase length is one day, round length is two days, phases
  // begin at the precise beginning of the day
  const secondsUntilNextPhase = SECONDS_IN_DAY - (parseInt(contractTime) % SECONDS_IN_DAY);
  const hoursUntilNextPhase = Math.floor(moment.duration(secondsUntilNextPhase, "seconds").asHours());
  const minutesInLastHour = Math.floor(moment.duration(secondsUntilNextPhase, "seconds").asMinutes()) % MINUTES_IN_HOUR;
  const hoursUntilNextRound = roundPhase === VotePhasesEnum.COMMIT ? hoursUntilNextPhase + 24 : hoursUntilNextPhase;

  return {
    minutesInLastHour,
    hoursUntilNextPhase,
    hoursUntilNextRound
  };
};

module.exports = votePhaseTiming;
