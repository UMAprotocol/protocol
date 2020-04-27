// The logger has a number of different levels based on the severity of the incident:
// -> Debugs: self explanatory. Normal status-based logging. These can trigger
//   every iteration. Unlimited volume. Prints to console.
// -> Info: when something happens that is notable, but not necessarily actionable.
//   These should not trigger every iteration. Any on-chain event that executed correctly.
//   Print to console & trigger a slack message.
// -> Error: anything that requires human intervention. If the bot is low on funds or a
//   transaction fails(some txn failures are sporadic and normal, but it may be difficult
//   to distinguish).These can trigger every iteration, but only if it's because the bot
//   encounters a persistent issue that requires human intervention to solve.
//   Print to console, trigger a slack message and place a phone call to DRI.

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
