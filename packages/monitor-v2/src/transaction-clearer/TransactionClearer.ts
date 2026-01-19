import { BigNumber } from "ethers";
import type { Logger as LoggerType } from "winston";
import type { Provider } from "@ethersproject/abstract-provider";
import { GasEstimator } from "@uma/financial-templates-lib";
import { MonitoringParams, NonceBacklogConfig } from "./common";

type FeeData = { maxFeePerGas: BigNumber; maxPriorityFeePerGas: BigNumber } | { gasPrice: BigNumber };

function isLondonFeeData(feeData: FeeData): feeData is { maxFeePerGas: BigNumber; maxPriorityFeePerGas: BigNumber } {
  return "maxFeePerGas" in feeData;
}

function bumpFeeData(baseFeeData: FeeData, attemptIndex: number, config: NonceBacklogConfig): FeeData {
  // Calculate multiplier: (numerator/denominator)^(attemptIndex+1)
  // For attempt 0: 1.2x, attempt 1: 1.44x, attempt 2: 1.73x (with default 12/10)
  let numerator = BigNumber.from(config.feeBumpNumerator);
  let denominator = BigNumber.from(config.feeBumpDenominator);

  for (let i = 0; i < attemptIndex; i++) {
    numerator = numerator.mul(config.feeBumpNumerator);
    denominator = denominator.mul(config.feeBumpDenominator);
  }

  if (isLondonFeeData(baseFeeData)) {
    return {
      maxFeePerGas: baseFeeData.maxFeePerGas.mul(numerator).div(denominator),
      maxPriorityFeePerGas: baseFeeData.maxPriorityFeePerGas.mul(numerator).div(denominator),
    };
  } else {
    return {
      gasPrice: baseFeeData.gasPrice.mul(numerator).div(denominator),
    };
  }
}

async function getNonces(
  provider: Provider,
  address: string
): Promise<{ latestNonce: number; pendingNonce: number }> {
  const [latestNonce, pendingNonce] = await Promise.all([
    provider.getTransactionCount(address, "latest"),
    provider.getTransactionCount(address, "pending"),
  ]);
  return { latestNonce, pendingNonce };
}

export async function clearStuckTransactions(
  logger: LoggerType,
  params: MonitoringParams,
  gasEstimator: GasEstimator
): Promise<void> {
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
    return;
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
}
