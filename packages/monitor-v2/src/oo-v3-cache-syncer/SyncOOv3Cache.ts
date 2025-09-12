import { EventSearchConfig, paginatedEventQuery } from "@uma/common";
import {
  OptimisticOracleV3Ethers,
  AddressWhitelistEthers,
  StoreEthers,
  IdentifierWhitelistEthers,
  FinderEthers,
} from "@uma/contracts-node";
import { AddedToWhitelistEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/AddressWhitelist";
import { SupportedIdentifierAddedEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/IdentifierWhitelist";
import type { GasEstimator } from "@uma/financial-templates-lib";
import { ethers } from "ethers";
import { getContractInstanceWithProvider } from "../utils/contracts";
import { Logger, MonitoringParams } from "./common";

async function syncOracle(
  logger: typeof Logger,
  params: MonitoringParams,
  oo: OptimisticOracleV3Ethers,
  gasEstimator: GasEstimator
) {
  const finder = await getContractInstanceWithProvider<FinderEthers>("Finder", params.provider);

  const currentOracle = await finder.getImplementationAddress(ethers.utils.formatBytes32String("Oracle"));
  const cachedOracle = await oo.cachedOracle();

  if (currentOracle.toLowerCase() !== cachedOracle.toLowerCase()) {
    logger.warn({
      at: "SyncOOv3Cache",
      message: "Out of sync oracle found",
      currentOracle,
      cachedOracle,
    });

    if (params.submitSyncTx === false) return; // If we are not submitting the sync transaction, we can exit early.

    try {
      const estimatedGas = await oo.estimateGas.syncUmaParams(ethers.constants.HashZero, ethers.constants.AddressZero);
      const gasLimitOverride = estimatedGas.mul(params.gasLimitMultiplier).div(100);
      const tx = await oo
        .connect(params.signer)
        .syncUmaParams(ethers.constants.HashZero, ethers.constants.AddressZero, {
          ...gasEstimator.getCurrentFastPriceEthers(),
          gasLimit: gasLimitOverride,
        });
      await tx.wait();
      logger.info({
        at: "SyncOOv3Cache",
        message: "Successfully synced oracle",
        tx: tx.hash,
        currentOracle,
        previousCachedOracle: cachedOracle,
      });
    } catch (error) {
      logger.error({
        at: "SyncOOv3Cache",
        message: "Error syncing oracle",
        currentOracle,
        previousCachedOracle: cachedOracle,
        error,
      });
    }
  } else {
    logger.debug({
      at: "SyncOOv3Cache",
      message: "Oracle is already in sync",
    });
  }
}

async function syncCollaterals(
  logger: typeof Logger,
  params: MonitoringParams,
  oo: OptimisticOracleV3Ethers,
  searchConfig: EventSearchConfig,
  gasEstimator: GasEstimator
) {
  type CachedCurrency = Awaited<ReturnType<OptimisticOracleV3Ethers["functions"]["cachedCurrencies"]>>;
  type FinalFee = Awaited<ReturnType<StoreEthers["functions"]["computeFinalFee"]>>;

  const addressWhitelist = await getContractInstanceWithProvider<AddressWhitelistEthers>(
    "AddressWhitelist",
    params.provider
  );
  const store = await getContractInstanceWithProvider<StoreEthers>("Store", params.provider);

  // Fetch all collaterals ever added on the AddressWhitelist contract.
  const allAddedCollaterals = (
    await paginatedEventQuery<AddedToWhitelistEvent>(
      addressWhitelist,
      addressWhitelist.filters.AddedToWhitelist(),
      searchConfig
    )
  ).map((event) => event.args.addedAddress);

  const currentCollaterals = await addressWhitelist.getWhitelist();

  const currentFinalFees = (await params.multicall
    .batch(
      store,
      allAddedCollaterals.map((currency) => ({
        method: "computeFinalFee",
        args: [currency],
      }))
    )
    .read()) as FinalFee[];

  const cachedCurrencies = (await params.multicall
    .batch(
      oo,
      allAddedCollaterals.map((currency) => ({
        method: "cachedCurrencies",
        args: [currency],
      }))
    )
    .read()) as CachedCurrency[];

  // Determine which collateral cache is out of sync (either wrong whitelist status or wrong final fee).
  const outOfSyncCollaterals = allAddedCollaterals.filter((currency, index) => {
    const isWhitelisted = currentCollaterals.includes(currency);
    const finalFee = currentFinalFees[index][0].rawValue;
    const cachedCurrency = cachedCurrencies[index];

    return cachedCurrency.isWhitelisted !== isWhitelisted || !cachedCurrency.finalFee.eq(finalFee);
  });
  if (outOfSyncCollaterals.length > 0) {
    logger.warn({
      at: "SyncOOv3Cache",
      message: "Out of sync collaterals found",
      count: outOfSyncCollaterals.length,
      collaterals: outOfSyncCollaterals,
    });
  } else {
    logger.debug({
      at: "SyncOOv3Cache",
      message: "No out of sync collaterals found",
    });
    return; // There are no out of sync collaterals, we can exit early.
  }

  if (params.submitSyncTx === false) return; // If we are not submitting the sync transaction, we can exit early.

  // Prepare and execute the multicall to sync the out of sync collaterals.
  const syncCalls = outOfSyncCollaterals.map((currency) =>
    oo.interface.encodeFunctionData("syncUmaParams", [ethers.constants.HashZero, currency])
  );
  try {
    const estimatedGas = await oo.estimateGas.multicall(syncCalls);
    const gasLimitOverride = estimatedGas.mul(params.gasLimitMultiplier).div(100);
    const tx = await oo
      .connect(params.signer)
      .multicall(syncCalls, { ...gasEstimator.getCurrentFastPriceEthers(), gasLimit: gasLimitOverride });
    await tx.wait();
    logger.info({
      at: "SyncOOv3Cache",
      message: "Successfully synced out of sync collaterals",
      count: outOfSyncCollaterals.length,
      tx: tx.hash,
      collaterals: outOfSyncCollaterals,
    });
  } catch (error) {
    logger.error({
      at: "SyncOOv3Cache",
      message: "Error syncing out of sync collaterals",
      collaterals: outOfSyncCollaterals,
      error,
    });
  }
}

async function syncIdentifiers(
  logger: typeof Logger,
  params: MonitoringParams,
  oo: OptimisticOracleV3Ethers,
  searchConfig: EventSearchConfig,
  gasEstimator: GasEstimator
) {
  type CachedIdentifier = Awaited<ReturnType<OptimisticOracleV3Ethers["functions"]["cachedIdentifiers"]>>;
  type IsIdentifierSupported = Awaited<ReturnType<IdentifierWhitelistEthers["functions"]["isIdentifierSupported"]>>;

  const identifierWhitelist = await getContractInstanceWithProvider<IdentifierWhitelistEthers>(
    "IdentifierWhitelist",
    params.provider
  );

  // Fetch all identifiers ever added on the IdentifierWhitelist contract.
  const allAddedIdentifiers = (
    await paginatedEventQuery<SupportedIdentifierAddedEvent>(
      identifierWhitelist,
      identifierWhitelist.filters.SupportedIdentifierAdded(),
      searchConfig
    )
  ).map((event) => event.args.identifier);

  const currentIdentifiers = (await params.multicall
    .batch(
      identifierWhitelist,
      allAddedIdentifiers.map((identifier) => ({
        method: "isIdentifierSupported",
        args: [identifier],
      }))
    )
    .read()) as IsIdentifierSupported[];

  const cachedIdentifiers = (await params.multicall
    .batch(
      oo,
      allAddedIdentifiers.map((identifier) => ({
        method: "cachedIdentifiers",
        args: [identifier],
      }))
    )
    .read()) as CachedIdentifier[];

  // Determine which identifier cache is out of sync (wrong whitelist status).
  const outOfSyncIdentifiers = allAddedIdentifiers.filter((_identifier, index) => {
    const isSupported = currentIdentifiers[index][0];
    const cachedIdentifier = cachedIdentifiers[index][0];

    return cachedIdentifier !== isSupported;
  });
  if (outOfSyncIdentifiers.length > 0) {
    logger.warn({
      at: "SyncOOv3Cache",
      message: "Out of sync identifiers found",
      count: outOfSyncIdentifiers.length,
      identifiers: outOfSyncIdentifiers.map((identifier) => ethers.utils.parseBytes32String(identifier)),
    });
  } else {
    logger.debug({
      at: "SyncOOv3Cache",
      message: "No out of sync identifiers found",
    });
    return; // There are no out of sync identifiers, we can exit early.
  }

  if (params.submitSyncTx === false) return; // If we are not submitting the sync transaction, we can exit early.

  // Prepare and execute the multicall to sync the out of sync identifiers.
  const syncCalls = outOfSyncIdentifiers.map((identifier) =>
    oo.interface.encodeFunctionData("syncUmaParams", [identifier, ethers.constants.AddressZero])
  );
  try {
    const estimatedGas = await oo.estimateGas.multicall(syncCalls);
    const gasLimitOverride = estimatedGas.mul(params.gasLimitMultiplier).div(100);
    const tx = await oo
      .connect(params.signer)
      .multicall(syncCalls, { ...gasEstimator.getCurrentFastPriceEthers(), gasLimit: gasLimitOverride });
    await tx.wait();
    logger.info({
      at: "SyncOOv3Cache",
      message: "Successfully synced out of sync identifiers",
      count: outOfSyncIdentifiers.length,
      tx: tx.hash,
      identifiers: outOfSyncIdentifiers.map((identifier) => ethers.utils.parseBytes32String(identifier)),
    });
  } catch (error) {
    logger.error({
      at: "SyncOOv3Cache",
      message: "Error syncing out of sync identifiers",
      identifiers: outOfSyncIdentifiers.map((identifier) => ethers.utils.parseBytes32String(identifier)),
      error,
    });
  }
}

export async function syncOOv3Cache(
  logger: typeof Logger,
  params: MonitoringParams,
  gasEstimator: GasEstimator
): Promise<void> {
  const oo = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", params.provider);

  const currentBlock = await params.provider.getBlock("latest");
  const searchConfig = {
    fromBlock: 0, // Since Store does not emit collateral address in events, we will need to get all historical currencies.
    toBlock: currentBlock.number,
    maxBlockLookBack: params.maxBlockLookBack,
  };

  await syncOracle(logger, params, oo, gasEstimator);
  await syncCollaterals(logger, params, oo, searchConfig, gasEstimator);
  await syncIdentifiers(logger, params, oo, searchConfig, gasEstimator);
}
