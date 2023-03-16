// The logger has a four different levels based on the severity of the incident:
// -> Debug. It can be considered a console log. Used periodically to inform status updates of repetitive state changes
//    like polling or no events found. Only viewable on GCE logs.
// -> Info. Used to report informative events, like a  liquidation/dispute/dispute settlement. These events are
//    noteworthy but don’t require action or acknowledgment from any
//    team member. Viewable on GCE logs and sends a slack message to appropriate channels.
// -> Warn. Used to report warning events that might require a response but don't necessarily indicate system failure.
//    Require Acknowledgment from the person on duty, or escalation occurs until the warning is acknowledged. For
//    example, warnings would be used to indicate that a bot’s balance has dropped below a given threshold or a
//    collateralization ratio of a given account moves below a threshold. Viewable on GCE logs, send a slack message to
//    the appropriate channel and initiates a PagerDuty incident with urgency set ‘low’.
// -> Error. Used to report system failure or situations that require an immediate response from appropriate team members.
//    For example, an error level message is generated when a liquidation/dispute/dispute settlement transaction from a
//    UMA bot reverts, token price deviates significantly from the target price or a bot crashes. Viewable on GCE logs,
//    send a slack message to the appropriate channel and initiates a PagerDuty incident with urgency setting ‘high’.

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

import winston from "winston";
import { createTransports } from "./Transports";
import { botIdentifyFormatter, errorStackTracerFormatter, bigNumberFormatter } from "./Formatters";
import { delay } from "../helpers/delay";

import type { Logger as _Logger } from "winston";
import type * as Transport from "winston-transport";

// This async function can be called by a bot if the log message is generated right before the process terminates.
// This method will check if the AugmentedLogger's isFlushed is set to true. If not, it will block until such time
// that it has been set to true. Note that each blocking transport should implement this isFlushed bool to prevent
// the logger from closing before all logs have been propagated.
export async function waitForLogger(logger: AugmentedLogger) {
  while (!logger.isFlushed) await delay(0.5); // While the logger is not flushed, wait for it to be flushed.
}

export interface AugmentedLogger extends _Logger {
  isFlushed: boolean;
}

export function createNewLogger(
  injectedTransports: Transport[] = [],
  transportsConfig = {},
  botIdentifier = process.env.BOT_IDENTIFIER || "NO_BOT_ID"
): AugmentedLogger {
  const logger = winston.createLogger({
    level: "debug",
    format: winston.format.combine(
      winston.format(botIdentifyFormatter(botIdentifier))(),
      winston.format((logEntry) => logEntry)(),
      winston.format(errorStackTracerFormatter)(),
      winston.format(bigNumberFormatter)(),
      winston.format.json()
    ),
    transports: [...createTransports(transportsConfig), ...injectedTransports],
    exitOnError: !!process.env.EXIT_ON_ERROR,
  }) as AugmentedLogger;
  logger.isFlushed = true; // The logger should start off in a flushed state of "true". i.e it is ready to be close.
  return logger;
}

export const Logger: AugmentedLogger = createNewLogger();
