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
import { PagerDutyTransport } from "./PagerDutyTransport";
import { PagerDutyV2Transport } from "./PagerDutyV2Transport";
import { TransportError } from "./TransportError";
import { createTransports } from "./Transports";
import { botIdentifyFormatter, errorStackTracerFormatter, bigNumberFormatter } from "./Formatters";
import { noBotId } from "../constants";
import { delay } from "../helpers/delay";
import { randomUUID } from "crypto";

import type { Logger as _Logger } from "winston";
import type * as Transport from "winston-transport";
import { PersistentTransport } from "./PersistentTransport";

// Custom interface for transports that have the isFlushed getter.
interface FlushableTransport extends Transport {
  isFlushed: boolean;
}

// Custom type guard function to check if a transport is of type FlushableTransport
function isFlushableTransport(transport: Transport): transport is FlushableTransport {
  return "isFlushed" in transport && typeof transport.isFlushed === "boolean";
}

// Function to check that all flushable transports attached to logger are in a flushed state.
function isLoggerFlushed(logger: AugmentedLogger): boolean {
  return logger.transports.filter(isFlushableTransport).every((transport) => transport.isFlushed);
}

// This async function can be called by a bot if the log message is generated right before the process terminates.
// This method will check if all transports attached to AugmentedLogger having isFlushed getter return it as true. If
// not, it will block until such time that all these transports have been flushed. This still can exit before all
// transports are flushed if the logger flush timeout is reached for non-persistent log queue transports.
export async function waitForLogger(logger: AugmentedLogger): Promise<void> {
  const waitForFlushed = async (): Promise<void> => {
    while (!isLoggerFlushed(logger)) await delay(0.5); // While the logger is not flushed, wait for it to be flushed.
  };
  // Wait for the logger to be flushed or for the logger flush timeout to be reached.
  await Promise.race([waitForFlushed(), delay(logger.flushTimeout)]);

  // Signal to pause log queue processing on persistent queue transports. This waits for current element to be logged.
  await pausePersistentLogQueueProcessing(logger.transports);
}

export interface AugmentedLogger extends _Logger {
  flushTimeout: number; // Timeout in seconds to wait for logger to flush before closing.
  transportErrorLogger: _Logger; // Dedicated logger for logging transport execution errors.
}

function createBaseLogger(
  level: string,
  transports: Transport[],
  botIdentifier: string,
  runIdentifier: string
): _Logger {
  return winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format(botIdentifyFormatter(botIdentifier, runIdentifier))(),
      winston.format((logEntry) => logEntry)(),
      winston.format(errorStackTracerFormatter)(),
      winston.format(bigNumberFormatter)(),
      winston.format.json()
    ),
    transports,
    exitOnError: !!process.env.EXIT_ON_ERROR,
  });
}

// Filter to select reliable transports that can be used to log transport execution errors from other transports.
// Currently only PagerDuty transports are supported and only if they are explicitly configured to log transport errors.
function filterLogErrorTransports(transports: Transport[]): Transport[] {
  return transports.filter(
    (transport) =>
      (transport instanceof PagerDutyTransport || transport instanceof PagerDutyV2Transport) &&
      transport.logTransportErrors
  );
}

// Signal pause queue processing from persistent storage on all transports that support it.
// This is intended to be used only when waiting for logger before termination.
async function pausePersistentLogQueueProcessing(transports: Transport[]): Promise<void> {
  const persistentTransports = transports.filter(
    (transport) => transport instanceof PersistentTransport
  ) as PersistentTransport[];

  // Signal pause queue processing, but wait for any currently processed elements still being logged.
  const pausePromises = persistentTransports.map((transport) => transport.pauseProcessing());
  await Promise.all(pausePromises);
}

// Initiate log queue processing from persistent storage on all transports that support it.
function resumeLogQueueProcessing(transports: Transport[]): void {
  for (const transport of transports) {
    // Initiate log que processing. We don't await it as this should run in background and it is controlled externally
    // via pauseProcessing method.
    if (transport instanceof PersistentTransport) transport.processLogQueue();
  }
}

export function generateRandomRunId() {
  return randomUUID();
}

export function createNewLogger(
  injectedTransports: Transport[] = [],
  transportsConfig = {},
  botIdentifier = process.env.BOT_IDENTIFIER || noBotId,
  runIdentifier = process.env.RUN_IDENTIFIER || generateRandomRunId()
): AugmentedLogger {
  const transports = [...createTransports(transportsConfig), ...injectedTransports];
  const logger = createBaseLogger("debug", transports, botIdentifier, runIdentifier) as AugmentedLogger;

  logger.flushTimeout = process.env.LOGGER_FLUSH_TIMEOUT ? parseInt(process.env.LOGGER_FLUSH_TIMEOUT) : 30;

  // Attach dedicated logger for handling and logging transport execution errors.
  logger.transportErrorLogger = createBaseLogger(
    "error",
    filterLogErrorTransports(logger.transports),
    botIdentifier,
    runIdentifier
  );
  logger.on("error", (error) => {
    if (error instanceof TransportError) {
      // We can detect transport source and failed log info from the error object if it is a TransportError.
      logger.transportErrorLogger.error({
        at: "TransportErrorHandler",
        message: error.message,
        originalError: error.originalError,
        originalInfo: error.originalInfo,
      });
    } else {
      // If the error is not a TransportError, we can only log the error itself.
      logger.transportErrorLogger.error({
        at: "TransportErrorHandler",
        message: "Error occurred during log execution",
        error,
      });
    }
  });

  // Resume log queue processing from persistent storage. Any errors should be handled by above error event listener.
  resumeLogQueueProcessing(logger.transports);

  return logger;
}

export const Logger: AugmentedLogger = createNewLogger();
