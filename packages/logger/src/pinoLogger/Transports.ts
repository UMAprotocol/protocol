import { transport, TransportTargetOptions } from "pino";
import type { Config as PagerDutyV2Config } from "../pagerduty/SharedConfig";
import { createConfig as pagerDutyV2CreateConfig } from "../pagerduty/SharedConfig";
import dotenv from "dotenv";
import minimist from "minimist";
import path from "path";

dotenv.config();
const argv = minimist(process.argv.slice(), {});

interface TransportsConfig {
  level?: string;
  pagerDutyV2Config?: PagerDutyV2Config & { disabled?: boolean };
}

export function createPinoTransports(transportsConfig: TransportsConfig = {}): ReturnType<typeof transport> {
  const targets: TransportTargetOptions[] = [];
  const level = transportsConfig.level || process.env.LOG_LEVEL || "info";

  // stdout transport (for GCP Logging and local dev)
  targets.push({
    target: "pino/file",
    level,
    options: { destination: 1 },
  });

  // Skip additional transports in test environment
  if (argv._.indexOf("test") === -1) {
    // Add PagerDuty V2 transport if configured
    if (transportsConfig.pagerDutyV2Config || process.env.PAGER_DUTY_V2_CONFIG) {
      // to disable pdv2, pass in a "disabled=true" in configs or env.
      const { disabled = false, ...pagerDutyV2Config } =
        transportsConfig.pagerDutyV2Config ?? JSON.parse(process.env.PAGER_DUTY_V2_CONFIG || "null");
      // this will throw an error if an invalid configuration is present
      if (!disabled) {
        targets.push({
          target: path.join(__dirname, "PagerDutyV2Transport.js"),
          level: "error",
          options: pagerDutyV2CreateConfig(pagerDutyV2Config),
        });
      }
    }
  }

  return transport({ targets });
}
