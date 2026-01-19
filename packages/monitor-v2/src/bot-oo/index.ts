import { delay, waitForLogger, GasEstimator } from "@uma/financial-templates-lib";
import { BigNumber } from "ethers";
import { BotModes, MonitoringParams, initMonitoringParams, Logger, startupLogLevel } from "./common";
import { settleRequests } from "./SettleRequests";

const logger = Logger;
const DEFAULT_REPLACEMENT_BUMP_PERCENT = 20;
const DEFAULT_REPLACEMENT_ATTEMPTS = 3;

type NonceBacklogConfig = {
  replacementBumpPercent: number;
  replacementAttempts: number;
};

const parsePositiveInt = (value: string | undefined, defaultValue: number, name: string): number => {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return parsed;
};

const getNonceBacklogConfig = (env: NodeJS.ProcessEnv): NonceBacklogConfig => ({
  replacementBumpPercent: parsePositiveInt(
    env.NONCE_REPLACEMENT_BUMP_PERCENT,
    DEFAULT_REPLACEMENT_BUMP_PERCENT,
    "NONCE_REPLACEMENT_BUMP_PERCENT"
  ),
  replacementAttempts: parsePositiveInt(
    env.NONCE_REPLACEMENT_ATTEMPTS,
    DEFAULT_REPLACEMENT_ATTEMPTS,
    "NONCE_REPLACEMENT_ATTEMPTS"
  ),
});

function bumpFeeData(
  feeData: ReturnType<GasEstimator["getCurrentFastPriceEthers"]>,
  bumps: number,
  config: NonceBacklogConfig
): ReturnType<GasEstimator["getCurrentFastPriceEthers"]> {
  if (bumps === 0) return feeData;

  const bumpValue = (value: BigNumber) => {
    let bumped = value;
    for (let i = 0; i < bumps; i++) {
      bumped = bumped.mul(100 + config.replacementBumpPercent).div(100);
    }
    return bumped;
  };

  if ("gasPrice" in feeData) {
    return { gasPrice: bumpValue(feeData.gasPrice) };
  }

  return {
    maxFeePerGas: bumpValue(feeData.maxFeePerGas),
    maxPriorityFeePerGas: bumpValue(feeData.maxPriorityFeePerGas),
  };
}

async function handleNonceBacklog(
  params: MonitoringParams,
  gasEstimator: GasEstimator,
  config: NonceBacklogConfig
): Promise<boolean> {
  const botAddress = await params.signer.getAddress();
  const [latestNonce, pendingNonce] = await Promise.all([
    params.provider.getTransactionCount(botAddress, "latest"),
    params.provider.getTransactionCount(botAddress, "pending"),
  ]);

  if (pendingNonce <= latestNonce) return false;

  logger.warn({
    at: "OracleBot",
    message: "Nonce backlog detected, skipping settlements for this run",
    botAddress,
    latestNonce,
    pendingNonce,
  });

  await gasEstimator.update();
  const baseFeeData = gasEstimator.getCurrentFastPriceEthers();

  for (let attempt = 1; attempt <= config.replacementAttempts; attempt++) {
    const feeData = bumpFeeData(baseFeeData, attempt - 1, config);
    try {
      const tx = await params.signer.sendTransaction({
        to: botAddress,
        value: 0,
        nonce: latestNonce,
        gasLimit: 21_000,
        ...feeData,
      });

      logger.info({
        at: "OracleBot",
        message: "Submitted nonce backlog cancellation transaction",
        tx: tx.hash,
        nonce: latestNonce,
        attempt,
        feeData,
      });

      await tx.wait(1);

      logger.info({
        at: "OracleBot",
        message: "Nonce backlog cancellation transaction mined",
        tx: tx.hash,
        nonce: latestNonce,
        attempt,
      });
      return true;
    } catch (error) {
      logger.warn({
        at: "OracleBot",
        message: "Nonce backlog cancellation transaction failed",
        attempt,
        nonce: latestNonce,
        error,
      });
    }
  }

  logger.error({
    at: "OracleBot",
    message: "Failed to clear nonce backlog, exiting early",
    nonce: latestNonce,
    pendingNonce,
  });

  return true;
}

async function main() {
  const params = await initMonitoringParams(process.env);

  logger[startupLogLevel(params)]({
    at: "OracleBot",
    message: `Optimistic Oracle Bot started 🤖`,
    oracleType: params.oracleType,
    oracleAddress: params.contractAddress,
    botModes: params.botModes,
  });

  const gasEstimator = new GasEstimator(logger, undefined, params.chainId, params.provider);
  const nonceBacklogConfig = getNonceBacklogConfig(process.env);

  const cmds = {
    settleRequestsEnabled: settleRequests,
  };

  for (;;) {
    const backlogDetected = await handleNonceBacklog(params, gasEstimator, nonceBacklogConfig);
    if (backlogDetected) {
      await delay(5); // Let any in-flight logs flush before exiting.
      await waitForLogger(logger);
      break;
    }

    await gasEstimator.update();

    const runCmds = Object.entries(cmds)
      .filter(([mode]) => params.botModes[mode as keyof BotModes])
      .map(([, cmd]) => cmd(logger, { ...params }, gasEstimator));

    await Promise.all(runCmds);

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
      at: "OracleBot",
      message: "Optimistic Oracle Bot execution error🚨",
      error,
    });
    // Wait 5 seconds to allow logger to flush.
    await delay(5);
    await waitForLogger(logger);
    process.exit(1);
  }
);
