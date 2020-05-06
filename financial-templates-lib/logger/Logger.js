// The logger has a four different levels based on the severity of the incident:
// -> Debug. Can be considered a console log. Used periodically to inform status updates of repetitive state changes like
//    polling or no events found. Only viewable on GCE logs.
// -> Info. Used to report informative events, like a liquidation/dispute/dispute settlement. These events are noteworthy
//    but don’t require action or acknowledgment from any team member. Viewable on GCE logs and sends a slack message
//    to appropriate channels.
// -> Warn. Used to report warning events that might require response but don't necessarily indicate system failure.
//    Require Acknowledgment from person on duty, or escalation occurs until warning is acknowledged. For example
//    warnings would be used to indicate that a bot’s balance has dropped below a given threshold or a collateralization
//    ratio of a given account moves below a threshold. Viewable on GCE logs, sends a slack message to appropriate
//    channel and initiates a PagerDuty incident with urgency setting ‘low’.
// -> Error. Used to report system failure or situations that require immediate response from appropriate team members.
//    For example an error level message is generated when a liquidation/dispute/dispute settlement transaction from a
//    UMA bot reverts, token price deviates significantly from the target price or a bot crashes. Viewable on GCE logs,
//    sends a slack message to appropriate channel and initiates a PagerDuty incident with urgency setting ‘high’.

// calling debug/info/error logging requires an specificity formatted json object as a param for the logger.
// All objects must have an `at`, `message` as a minimum to describe where the error was logged from
// and what has occurred. Any addition key value pairing can be attached, including json objects which
// will be spread. A transaction should be within an object that contains a `tx` key containing the mined
// transaction hash. See `liquidator.js` for an example. An example object is shown below:

// Logger.error({
//   at: "liquidator",
//   message: "failed to withdraw rewards from liquidation",
//   address: liquidation.sponsor,
//   id: liquidation.id
// });

const winston = require("winston");
const { transports } = require("./Transports");

const Logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(winston.format(info => info)(), winston.format.json()),
  transports,
  exitOnError: false
});

module.exports = {
  Logger
};
