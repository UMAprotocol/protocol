import { pino, LevelWithSilentOrString, Logger as PinoLogger, LoggerOptions as PinoLoggerOptions } from "pino";
import { createGcpLoggingPinoConfig } from "@google-cloud/pino-logging-gcp-config";
import { noBotId } from "./constants";
import { generateRandomRunId } from "./logger/Logger";

export type { PinoLogger };
export type { PinoLoggerOptions };

type CustomPinoLoggerOptions = {
  botIdentifier: string;
  runIdentifier: string;
  level: LevelWithSilentOrString;
};

export function createPinoLogger({
  botIdentifier = process.env.BOT_IDENTIFIER || noBotId,
  runIdentifier = process.env.RUN_IDENTIFIER || generateRandomRunId(),
  level = "info",
}: Partial<CustomPinoLoggerOptions> = {}): PinoLogger {
  return pino(createPinoConfig({ botIdentifier, runIdentifier, level }));
}

export function createPinoConfig({
  botIdentifier = process.env.BOT_IDENTIFIER || noBotId,
  runIdentifier = process.env.RUN_IDENTIFIER || generateRandomRunId(),
  level = "info",
}: Partial<CustomPinoLoggerOptions> = {}): PinoLoggerOptions {
  return createGcpLoggingPinoConfig(undefined, {
    level,
    base: { "bot-identifier": botIdentifier, "run-identifier": runIdentifier },
  });
}
