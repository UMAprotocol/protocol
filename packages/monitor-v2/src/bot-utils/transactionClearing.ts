import { BigNumber } from "ethers";
import type { Logger as LoggerType } from "winston";
import type { Provider } from "@ethersproject/abstract-provider";
import type { Signer } from "ethers";
import { GasEstimator } from "@uma/financial-templates-lib";

export interface NonceBacklogConfig {
  // Minimum nonce difference (pending - latest) to trigger clearing
  nonceBacklogThreshold: number;
  // Fee bump percentage per attempt (e.g., 20 means 20% increase)
  feeBumpPercent: number;
  // Max attempts to replace a stuck transaction with increasing fees
  replacementAttempts: number;
}

export interface TransactionClearingParams {
  provider: Provider;
  signer: Signer;
  nonceBacklogConfig: NonceBacklogConfig;
}

type FeeData = { maxFeePerGas: BigNumber; maxPriorityFeePerGas: BigNumber } | { gasPrice: BigNumber };

function isLondonFeeData(feeData: FeeData): feeData is { maxFeePerGas: BigNumber; maxPriorityFeePerGas: BigNumber } {
  return "maxFeePerGas" in feeData;
}

export const parsePositiveInt = (value: string | undefined, defaultValue: number, name: string): number => {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return parsed;
};

export const getNonceBacklogConfig = (env: NodeJS.ProcessEnv): NonceBacklogConfig => {
  return {
    nonceBacklogThreshold: parsePositiveInt(env.NONCE_BACKLOG_THRESHOLD, 1, "NONCE_BACKLOG_THRESHOLD"),
    feeBumpPercent: parsePositiveInt(env.NONCE_REPLACEMENT_BUMP_PERCENT, 20, "NONCE_REPLACEMENT_BUMP_PERCENT"),
    replacementAttempts: parsePositiveInt(env.NONCE_REPLACEMENT_ATTEMPTS, 3, "NONCE_REPLACEMENT_ATTEMPTS"),
  };
};

function bumpFeeData(baseFeeData: FeeData, attemptIndex: number, config: NonceBacklogConfig): FeeData {
  // Calculate multiplier: ((100 + percent) / 100)^(attemptIndex+1)
  // For attempt 0: 1.2x, attempt 1: 1.44x, attempt 2: 1.73x (with default 20%)
  const bumpValue = (value: BigNumber): BigNumber => {
    let bumped = value;
    for (let i = 0; i <= attemptIndex; i++) {
      bumped = bumped.mul(100 + config.feeBumpPercent).div(100);
    }
    return bumped;
  };

  if (isLondonFeeData(baseFeeData)) {
    return {
      maxFeePerGas: bumpValue(baseFeeData.maxFeePerGas),
      maxPriorityFeePerGas: bumpValue(baseFeeData.maxPriorityFeePerGas),
    };
  } else {
    return {
      gasPrice: bumpValue(baseFeeData.gasPrice),
    };
  }
}

async function getNonces(provider: Provider, address: string): Promise<{ latestNonce: number; pendingNonce: number }> {
  const [latestNonce, pendingNonce] = await Promise.all([
    provider.getTransactionCount(address, "latest"),
    provider.getTransactionCount(address, "pending"),
  ]);
  return { latestNonce, pendingNonce };
}

/**
 * Clears stuck transactions by sending self-transactions with higher gas fees.
 * @returns true if a nonce backlog was detected and clearing was attempted
 */
export async function clearStuckTransactions(
  logger: LoggerType,
  params: TransactionClearingParams,
  gasEstimator: GasEstimator
): Promise<boolean> {
  const { provider, signer, nonceBacklogConfig } = params;
  const botAddress = await signer.getAddress();

  const { latestNonce, pendingNonce } = await getNonces(provider, botAddress);
  const backlog = pendingNonce - latestNonce;

  if (backlog < nonceBacklogConfig.nonceBacklogThreshold) {
    logger.debug({
      at: "TransactionClearer",
      message: "No nonce backlog detected",
      botAddress,
      latestNonce,
      pendingNonce,
      backlog,
      threshold: nonceBacklogConfig.nonceBacklogThreshold,
    });
    return false;
  }

  logger.warn({
    at: "TransactionClearer",
    message: "Nonce backlog detected, attempting to clear stuck transactions",
    botAddress,
    latestNonce,
    pendingNonce,
    backlog,
    threshold: nonceBacklogConfig.nonceBacklogThreshold,
  });

  // Get base fee data from gas estimator
  const baseFeeData = gasEstimator.getCurrentFastPriceEthers();

  // Clear all stuck nonces from latestNonce to pendingNonce - 1
  for (let nonce = latestNonce; nonce < pendingNonce; nonce++) {
    let cleared = false;

    for (let attempt = 0; attempt < nonceBacklogConfig.replacementAttempts; attempt++) {
      const feeData = bumpFeeData(baseFeeData, attempt, nonceBacklogConfig);

      try {
        logger.info({
          at: "TransactionClearer",
          message: `Attempting to clear stuck transaction (nonce ${nonce}, attempt ${attempt + 1})`,
          botAddress,
          nonce,
          attempt: attempt + 1,
          feeData: isLondonFeeData(feeData)
            ? {
                maxFeePerGas: feeData.maxFeePerGas.toString(),
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.toString(),
              }
            : { gasPrice: feeData.gasPrice.toString() },
        });

        const tx = await signer.sendTransaction({
          to: botAddress, // Self-transaction
          value: 0,
          nonce,
          gasLimit: 21_000,
          ...feeData,
        });

        const receipt = await tx.wait(1);

        logger.info({
          at: "TransactionClearer",
          message: `Successfully cleared stuck transaction (nonce ${nonce})`,
          botAddress,
          nonce,
          transactionHash: receipt.transactionHash,
          gasUsed: receipt.gasUsed.toString(),
        });

        cleared = true;
        break;
      } catch (error) {
        logger.warn({
          at: "TransactionClearer",
          message: `Failed to clear stuck transaction (nonce ${nonce}, attempt ${attempt + 1})`,
          botAddress,
          nonce,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!cleared) {
      logger.error({
        at: "TransactionClearer",
        message: `Failed to clear stuck transaction after all attempts (nonce ${nonce})`,
        botAddress,
        nonce,
        maxAttempts: nonceBacklogConfig.replacementAttempts,
      });
    }
  }

  // Verify final state
  const { latestNonce: finalLatestNonce, pendingNonce: finalPendingNonce } = await getNonces(provider, botAddress);
  const finalBacklog = finalPendingNonce - finalLatestNonce;

  if (finalBacklog < nonceBacklogConfig.nonceBacklogThreshold) {
    logger.info({
      at: "TransactionClearer",
      message: "Successfully cleared nonce backlog",
      botAddress,
      previousBacklog: backlog,
      finalBacklog,
    });
  } else {
    logger.warn({
      at: "TransactionClearer",
      message: "Nonce backlog still present after clearing attempt",
      botAddress,
      previousBacklog: backlog,
      finalBacklog,
    });
  }

  return true;
}
