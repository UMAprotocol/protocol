import { pino, LevelWithSilentOrString, Logger as PinoLogger } from "pino";
import { createGcpLoggingPinoConfig } from "@google-cloud/pino-logging-gcp-config";
import { noBotId } from "./constants";
import { generateRandomRunId } from "./logger/Logger";

export type { PinoLogger };

type PinoLoggerOptions = {
  botIdentifier: string;
  runIdentifier: string;
  level: LevelWithSilentOrString;
};

export function createPinoLogger({
  botIdentifier = process.env.BOT_IDENTIFIER || noBotId,
  runIdentifier = process.env.RUN_IDENTIFIER || generateRandomRunId(),
  level = "info",
}: Partial<PinoLoggerOptions> = {}): PinoLogger {
  return pino(
    createGcpLoggingPinoConfig(undefined, {
      level,
      base: { "bot-identifier": botIdentifier, "run-identifier": runIdentifier },
    })
  );
}
