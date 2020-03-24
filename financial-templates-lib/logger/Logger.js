// The logger has a number of different levels based on the severity of the incident:
//-> Debugs: self explanatory. Normal status-based logging. These can trigger
//   every iteration. Unlimited volume.
//-> Info: when something happens that is notable, but not necessarily actionable.
//   These should not trigger every iteration. Any on-chain event that executed correctly.
//   these trigger a slack message that everyone has access to.
//-> Error: anything that requires human intervention. If the bot is low on funds or a
//   transaction fails(some txn failures are sporadic and normal, but it may be difficult
//   to distinguish).These can trigger every iteration, but only if it's because the bot
//   encounters a persistent issue that requires human intervention to solve.Trigger a DM
//   to oncall, text / call to oncall, and publish to a slack channel that nobody has muted
//   (or just use @channel to force a notif).

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
const { transports } = require("./Transport");

const Logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(winston.format(info => info)(), winston.format.json()),
  transports,
  exitOnError: false
});

module.exports = {
  Logger
};
