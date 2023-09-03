import { delay, waitForLogger } from "@uma/financial-templates-lib";
import { BotModes, initBotParams, Logger, startupLogLevel } from "./common";
import { disputeDisputableRequests } from "./DisputeDisputableRequests";

const logger = Logger;

async function main() {
  const params = await initBotParams(process.env);

  logger[startupLogLevel(params)]({
    at: "LLMDisputeBot",
    message: "LLMDisputeBot started 🤖",
    botModes: params.botModes,
  });

  const cmds = {
    disputeRequestsEnabled: disputeDisputableRequests,
  };

  for (;;) {
    const runCmds = Object.entries(cmds)
      .filter(([mode]) => params.botModes[mode as keyof BotModes])
      .map(([, cmd]) => cmd(logger, { ...params }));

    for (const cmd of runCmds) {
      await cmd;
    }

    if (params.pollingDelay !== 0) {
      await delay(params.pollingDelay);
    } else {
      await delay(5); // Set a delay to let the transports flush fully.
      await waitForLogger(logger);
      break;
    }
  }
}

main().then(
  () => {
    process.exit(0);
  },
  async (error) => {
    logger.error({
      at: "LLMDisputeBot",
      message: "LLMDisputeBot error🚨",
      error,
    });
    // Wait 5 seconds to allow logger to flush.
    await delay(5);
    await waitForLogger(logger);
    process.exit(1);
  }
);
