import { ZERO_ADDRESS } from "@uma/common";
import {
  AddressWhitelistEthers,
  ExpandedERC20Ethers,
  FinderEthers,
  IdentifierWhitelistEthers,
  MockOracleAncillaryEthers,
  Multicall3Ethers,
  OptimisticOracleV3Ethers,
  StoreEthers,
} from "@uma/contracts-node";
import { spyLogLevel, GasEstimator } from "@uma/financial-templates-lib";
import { assert } from "chai";
import { syncOOv3Cache } from "../src/oo-v3-cache-syncer/SyncOOv3Cache";
import { defaultOptimisticOracleV3Identifier } from "./constants";
import { optimisticOracleV3Fixture } from "./fixtures/OptimisticOracleV3.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { formatBytes32String, getContractFactory, hre, parseBytes32String, Signer } from "./utils";
import { makeSpyLogger } from "./helpers/logging";
import { makeMonitoringParamsOOv3Cache } from "./helpers/monitoring";
const ethers = hre.ethers;

describe("SyncOOv3Cache", function () {
  let mockOracle: MockOracleAncillaryEthers;
  let finder: FinderEthers;
  let collateralWhitelist: AddressWhitelistEthers;
  let store: StoreEthers;
  let identifierWhitelist: IdentifierWhitelistEthers;
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV3: OptimisticOracleV3Ethers;
  let multicall3: Multicall3Ethers;
  let deployer: Signer;

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    const umaContracts = await umaEcosystemFixture();
    mockOracle = umaContracts.mockOracle;
    finder = umaContracts.finder;
    collateralWhitelist = umaContracts.collateralWhitelist;
    store = umaContracts.store;
    identifierWhitelist = umaContracts.identifierWhitelist;
    const optimisticOracleV3Contracts = await optimisticOracleV3Fixture();
    bondToken = optimisticOracleV3Contracts.bondToken;
    optimisticOracleV3 = optimisticOracleV3Contracts.optimisticOracleV3;
    multicall3 = (await (await getContractFactory("Multicall3", deployer)).deploy()) as Multicall3Ethers;
  });

  it("Does not sync if cache is up to date", async function () {
    const { spy, logger } = makeSpyLogger();
    await syncOOv3Cache(logger, await makeMonitoringParamsOOv3Cache(multicall3.address), new GasEstimator(logger));

    const syncedOracleIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "Oracle is already in sync" && c.lastArg?.at === "SyncOOv3Cache");
    assert.isAbove(syncedOracleIndex, -1, "Expected an already synced oracle log to be emitted");
    assert.equal(spyLogLevel(spy, syncedOracleIndex), "debug");

    const syncedCollateralsIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "No out of sync collaterals found" && c.lastArg?.at === "SyncOOv3Cache");
    assert.isAbove(syncedCollateralsIndex, -1, "Expected an already synced collaterals log to be emitted");
    assert.equal(spyLogLevel(spy, syncedCollateralsIndex), "debug");

    const syncedIdentifiersIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "No out of sync identifiers found" && c.lastArg?.at === "SyncOOv3Cache");
    assert.isAbove(syncedIdentifiersIndex, -1, "Expected an already synced identifiers log to be emitted");
    assert.equal(spyLogLevel(spy, syncedIdentifiersIndex), "debug");
  });

  it("Syncs cached Oracle", async function () {
    // Deploy and setup a new mock oracle
    const newMockOracle = (await (await getContractFactory("MockOracleAncillary", deployer)).deploy(
      finder.address,
      ZERO_ADDRESS
    )) as MockOracleAncillaryEthers;
    await finder.changeImplementationAddress(formatBytes32String("Oracle"), newMockOracle.address);

    // Call syncOOv3Cache directly.
    const { spy, logger } = makeSpyLogger();
    await syncOOv3Cache(logger, await makeMonitoringParamsOOv3Cache(multicall3.address), new GasEstimator(logger));

    const cachedOracle = await optimisticOracleV3.cachedOracle();
    assert.equal(cachedOracle, newMockOracle.address, "Cached oracle should be the new mock oracle address");

    const syncedIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "Successfully synced oracle" && c.lastArg?.at === "SyncOOv3Cache");
    assert.isAbove(syncedIndex, -1, "Expected a synced oracle log to be emitted");
    assert.equal(spy.getCall(syncedIndex).lastArg.currentOracle, newMockOracle.address);
    assert.equal(spy.getCall(syncedIndex).lastArg.previousCachedOracle, mockOracle.address);
    assert.equal(spyLogLevel(spy, syncedIndex), "info");
  });

  it("Syncs added collateral", async function () {
    // Add new collateral to the AddressWhitelist.
    const newBondToken = (await (await getContractFactory("ExpandedERC20", deployer)).deploy(
      "New bond token",
      "NBT",
      18
    )) as ExpandedERC20Ethers;
    await collateralWhitelist.addToWhitelist(newBondToken.address);

    const { spy, logger } = makeSpyLogger();
    await syncOOv3Cache(logger, await makeMonitoringParamsOOv3Cache(multicall3.address), new GasEstimator(logger));

    const cachedCollateral = await optimisticOracleV3.cachedCurrencies(newBondToken.address);
    assert.isTrue(cachedCollateral.isWhitelisted, "The new bond token should be added to the cache");

    const syncedIndex = spy
      .getCalls()
      .findIndex(
        (c) => c.lastArg?.message === "Successfully synced out of sync collaterals" && c.lastArg?.at === "SyncOOv3Cache"
      );
    assert.isAbove(syncedIndex, -1, "Expected a synced collateral log to be emitted");
    assert.equal(spy.getCall(syncedIndex).lastArg.count, 1);
    const emittedCollaterals = spy.getCall(syncedIndex).lastArg.collaterals;
    assert.isArray(emittedCollaterals, "Expected collaterals to be an array");
    assert.isTrue(
      emittedCollaterals.includes(newBondToken.address),
      "Expected new bond token to be included in the emitted collaterals"
    );
    assert.equal(spyLogLevel(spy, syncedIndex), "info");
  });

  it("Syncs removed collateral", async function () {
    // Remove the collateral from the AddressWhitelist.
    await collateralWhitelist.removeFromWhitelist(bondToken.address);

    const { spy, logger } = makeSpyLogger();
    await syncOOv3Cache(logger, await makeMonitoringParamsOOv3Cache(multicall3.address), new GasEstimator(logger));

    const cachedCollateral = await optimisticOracleV3.cachedCurrencies(bondToken.address);
    assert.isFalse(cachedCollateral.isWhitelisted, "The bond token should be removed from the cache");

    const syncedIndex = spy
      .getCalls()
      .findIndex(
        (c) => c.lastArg?.message === "Successfully synced out of sync collaterals" && c.lastArg?.at === "SyncOOv3Cache"
      );
    assert.isAbove(syncedIndex, -1, "Expected a synced collateral log to be emitted");
    assert.equal(spy.getCall(syncedIndex).lastArg.count, 1);
    const emittedCollaterals = spy.getCall(syncedIndex).lastArg.collaterals;
    assert.isArray(emittedCollaterals, "Expected collaterals to be an array");
    assert.isTrue(
      emittedCollaterals.includes(bondToken.address),
      "Expected removed bond token to be included in the emitted collaterals"
    );
    assert.equal(spyLogLevel(spy, syncedIndex), "info");
  });

  it("Syncs final fee change for collateral", async function () {
    // Double the final fee for the bond token.
    const newFinalFee = (await store.computeFinalFee(bondToken.address)).rawValue.mul(2);
    await store.setFinalFee(bondToken.address, { rawValue: newFinalFee });

    const { spy, logger } = makeSpyLogger();
    await syncOOv3Cache(logger, await makeMonitoringParamsOOv3Cache(multicall3.address), new GasEstimator(logger));

    const cachedCollateral = await optimisticOracleV3.cachedCurrencies(bondToken.address);
    assert.isTrue(cachedCollateral.finalFee.eq(newFinalFee), "The final fee should be updated in the cache");

    const syncedIndex = spy
      .getCalls()
      .findIndex(
        (c) => c.lastArg?.message === "Successfully synced out of sync collaterals" && c.lastArg?.at === "SyncOOv3Cache"
      );
    assert.isAbove(syncedIndex, -1, "Expected a synced collateral log to be emitted");
    assert.equal(spy.getCall(syncedIndex).lastArg.count, 1);
    const emittedCollaterals = spy.getCall(syncedIndex).lastArg.collaterals;
    assert.isArray(emittedCollaterals, "Expected collaterals to be an array");
    assert.isTrue(
      emittedCollaterals.includes(bondToken.address),
      "Expected bond token to be included in the emitted collaterals"
    );
    assert.equal(spyLogLevel(spy, syncedIndex), "info");
  });

  it("Syncs added identifier", async function () {
    // Add a new identifier to the IdentifierWhitelist.
    const newIdentifier = "NEW_IDENTIFIER";
    await identifierWhitelist.addSupportedIdentifier(formatBytes32String(newIdentifier));

    const { spy, logger } = makeSpyLogger();
    await syncOOv3Cache(logger, await makeMonitoringParamsOOv3Cache(multicall3.address), new GasEstimator(logger));
    const cachedIdentifier = await optimisticOracleV3.cachedIdentifiers(formatBytes32String(newIdentifier));
    assert.isTrue(cachedIdentifier, "The new identifier should be added to the cache");

    const syncedIndex = spy
      .getCalls()
      .findIndex(
        (c) => c.lastArg?.message === "Successfully synced out of sync identifiers" && c.lastArg?.at === "SyncOOv3Cache"
      );
    assert.isAbove(syncedIndex, -1, "Expected a synced identifier log to be emitted");
    assert.equal(spy.getCall(syncedIndex).lastArg.count, 1);
    const emittedIdentifiers = spy.getCall(syncedIndex).lastArg.identifiers;
    assert.isArray(emittedIdentifiers, "Expected identifiers to be an array");
    assert.isTrue(
      emittedIdentifiers.includes(newIdentifier),
      "Expected new identifier to be included in the emitted identifiers"
    );
    assert.equal(spyLogLevel(spy, syncedIndex), "info");
  });

  it("Syncs removed identifier", async function () {
    // Remove the identifier from the IdentifierWhitelist.
    await identifierWhitelist.removeSupportedIdentifier(defaultOptimisticOracleV3Identifier);

    const { spy, logger } = makeSpyLogger();
    await syncOOv3Cache(logger, await makeMonitoringParamsOOv3Cache(multicall3.address), new GasEstimator(logger));

    const cachedIdentifier = await optimisticOracleV3.cachedIdentifiers(defaultOptimisticOracleV3Identifier);
    assert.isFalse(cachedIdentifier, "The identifier should be removed from the cache");

    const syncedIndex = spy
      .getCalls()
      .findIndex(
        (c) => c.lastArg?.message === "Successfully synced out of sync identifiers" && c.lastArg?.at === "SyncOOv3Cache"
      );
    assert.isAbove(syncedIndex, -1, "Expected a synced identifier log to be emitted");
    assert.equal(spy.getCall(syncedIndex).lastArg.count, 1);
    const emittedIdentifiers = spy.getCall(syncedIndex).lastArg.identifiers;
    assert.isArray(emittedIdentifiers, "Expected identifiers to be an array");
    assert.isTrue(
      emittedIdentifiers.includes(parseBytes32String(defaultOptimisticOracleV3Identifier)),
      "Expected removed identifier to be included in the emitted identifiers"
    );
    assert.equal(spyLogLevel(spy, syncedIndex), "info");
  });
});
