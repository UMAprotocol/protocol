const { VotePhasesEnum } = require("../../../../common/Enums");
const moment = require("moment");
const SECONDS_IN_DAY = 86400;
const MINUTES_IN_HOUR = 60;

module.exports = (contractTime, roundPhase) => {
  // Phase length is one day, round length is two days, phases
  // begin at the precise beginning of the day
  const secondsUntilNextPhase = SECONDS_IN_DAY - (parseInt(contractTime) % SECONDS_IN_DAY);
  const hoursUntilNextPhase = Math.floor(moment.duration(secondsUntilNextPhase, "seconds").asHours());
  const minutesInLastHour = Math.floor(moment.duration(secondsUntilNextPhase, "seconds").asMinutes()) % MINUTES_IN_HOUR;
  const hoursUntilNextRound =
    roundPhase.toString() === VotePhasesEnum.COMMIT ? hoursUntilNextPhase + 24 : hoursUntilNextPhase;

  return {
    minutesInLastHour,
    hoursUntilNextPhase,
    hoursUntilNextRound
  };
};
