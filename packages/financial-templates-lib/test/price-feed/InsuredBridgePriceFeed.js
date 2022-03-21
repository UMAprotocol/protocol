const winston = require("winston");
const { assert } = require("chai");
const hre = require("hardhat");
const { web3, network } = require("hardhat");

const { across } = require("@uma/sdk");
const {
  interfaceName,
  TokenRolesEnum,
  InsuredBridgeRelayStateEnum,
  ZERO_ADDRESS,
  mineTransactionsAtTimeHardhat,
} = require("@uma/common");
const { SpyTransport, lastSpyLogIncludes } = require("../../dist/logger/SpyTransport");
const sinon = require("sinon");
const { getContract } = hre;
const { utf8ToHex, toWei, toBN } = web3.utils;
const toBNWei = (number) => toBN(toWei(number.toString()).toString());

const chainId = 10;
const Messenger = getContract("MessengerMock");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("SkinnyOptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");

// Pull in contracts from contracts-node sourced from the across repo.
const { getAbi, getBytecode } = require("@uma/contracts-node");

const BridgeDepositBox = getContract("BridgeDepositBoxMock", {
  abi: getAbi("BridgeDepositBoxMock"),
  bytecode: getBytecode("BridgeDepositBoxMock"),
});

const BridgePool = getContract("BridgePool", { abi: getAbi("BridgePool"), bytecode: getBytecode("BridgePool") });

const BridgeAdmin = getContract("BridgeAdmin", { abi: getAbi("BridgeAdmin"), bytecode: getBytecode("BridgeAdmin") });

const RateModelStore = getContract("RateModelStore", {
  abi: getAbi("RateModelStore"),
  bytecode: getBytecode("RateModelStore"),
});

// Pricefeed to test
const { InsuredBridgePriceFeed } = require("../../dist/price-feed/InsuredBridgePriceFeed");
const { InsuredBridgeL1Client } = require("../../dist/clients/InsuredBridgeL1Client");
const { InsuredBridgeL2Client } = require("../../dist/clients/InsuredBridgeL2Client");

// Contract objects
let messenger, bridgeAdmin, bridgePool;

// Tested clients
let pricefeed;
let l1Client;
let l2Client;
let spy;
let spyLogger;

let finder,
  store,
  bridgeAdminImpersonator,
  identifierWhitelist,
  collateralWhitelist,
  depositBox,
  timer,
  optimisticOracle,
  l1Token,
  l2Token,
  depositData,
  rateModelStore,
  relayData,
  relayAncillaryData,
  rateModels;

// Hard-coded test params:
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const initialPoolLiquidity = toWei("100");
const relayAmount = toWei("10");
const defaultProposerBondPct = toWei("0.05");
const defaultSlowRelayFeePct = toWei("0.01");
const defaultInstantRelayFeePct = toWei("0.01");
const lpFeeRatePerSecond = toWei("0.0000015");
const finalFee = toWei("1");
const proposerBond = toBN(defaultProposerBondPct)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")))
  .toString();
const defaultGasLimit = 1_000_000;
const defaultGasPrice = toWei("1", "gwei");
const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const quoteTimestampOffset = 60; // 60 seconds into the past.

describe("InsuredBridgePriceFeed", function () {
  let accounts, owner, depositor, relayer, liquidityProvider, l1Recipient;

  const generateRelayParams = (depositDataOverride = {}, relayDataOverride = {}) => {
    const _depositData = { ...depositData, ...depositDataOverride };
    const _relayData = { ...relayData, ...relayDataOverride };
    return [_depositData, _relayData.realizedLpFeePct];
  };

  const generateRelayAncillaryData = async (depositData, relayData, bridgePool) => {
    return await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call();
  };

  const generateRelayData = async (
    bridgePool,
    quoteTimestamp,
    depositTimestamp,
    depositDataOverride,
    relayDataOverride
  ) => {
    depositData = {
      chainId: 10,
      depositId: 0,
      l1Recipient: l1Recipient,
      l2Sender: depositor,
      l1Token: l1Token.options.address,
      amount: relayAmount,
      slowRelayFeePct: defaultSlowRelayFeePct,
      instantRelayFeePct: defaultInstantRelayFeePct,
      quoteTimestamp,
      ...depositDataOverride,
    };

    relayData = {
      relayId: 0,
      relayState: InsuredBridgeRelayStateEnum.UNINITIALIZED,
      priceRequestTime: depositTimestamp,
      // This should match the realized fee % that the L1 client computes, otherwise the pricefeed will determine the
      // relay to be invalid.
      realizedLpFeePct: across.feeCalculator
        .calculateRealizedLpFeePct(rateModels[l1Token.options.address], toBNWei("0"), toBNWei("0.1"))
        .toString(),
      slowRelayer: relayer,
      finalFee,
      proposerBond,
      ...relayDataOverride,
    };

    relayAncillaryData = await generateRelayAncillaryData(depositData, relayData, bridgePool);
    return { depositData, relayAncillaryData, relayData };
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, depositor, relayer, liquidityProvider, l1Recipient, bridgeAdminImpersonator] = accounts;

    finder = await Finder.new().send({ from: owner });
    collateralWhitelist = await AddressWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: owner });

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: owner });
    timer = await Timer.new().send({ from: owner });
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: owner });

    // Other contract setup needed to relay deposit:
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: owner });
  });

  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    l1Token = await ERC20.new("TESTERC20", "TESTERC20", 18).send({ from: owner });
    await l1Token.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: owner });
    await store.methods.setFinalFee(l1Token.options.address, { rawValue: finalFee }).send({ from: owner });

    // Deploy new OptimisticOracle so that we can control its timing:
    // - Set initial liveness to something != `defaultLiveness` so we can test that the custom liveness is set
    //   correctly by the BridgePool.
    optimisticOracle = await OptimisticOracle.new(
      defaultLiveness * 10,
      finder.options.address,
      timer.options.address
    ).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.SkinnyOptimisticOracle), optimisticOracle.options.address)
      .send({ from: owner });

    // Set up the Insured bridge contracts.

    // Deploy and setup BridgeAdmin
    messenger = await Messenger.new().send({ from: owner });
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: owner });

    // Deploy a bridgePool and whitelist it.
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      false,
      timer.options.address
    ).send({ from: owner });

    // Deploy L2 deposit contract:
    depositBox = await BridgeDepositBox.new(
      bridgeAdminImpersonator,
      minimumBridgingDelay,
      ZERO_ADDRESS, // Weth contract. not used in this set of tests.
      timer.options.address
    ).send({ from: owner });

    l2Token = await ERC20.new("L2 Wrapped Ether", "WETH", 18).send({ from: owner });
    await l2Token.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });

    // Whitelist the token in the deposit box.
    await depositBox.methods
      .whitelistToken(l1Token.options.address, l2Token.options.address, bridgePool.options.address)
      .send({ from: bridgeAdminImpersonator });

    // Connect L1 and L2 contracts:
    await bridgeAdmin.methods
      .setDepositContract(chainId, depositBox.options.address, messenger.options.address)
      .send({ from: owner });

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(
        chainId,
        l1Token.options.address,
        l2Token.options.address,
        bridgePool.options.address,
        0,
        defaultGasLimit,
        defaultGasPrice,
        0
      )
      .send({ from: owner });

    // Add some liquidity to the pool to facilitate bridging actions.
    await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });

    const liquidityAdditionTime = Number(await bridgePool.methods.getCurrentTime().call()) + 100;
    await mineTransactionsAtTimeHardhat(
      network,
      [bridgePool.methods.addLiquidity(initialPoolLiquidity)],
      liquidityAdditionTime,
      liquidityProvider
    );

    await bridgePool.methods.setCurrentTime(liquidityAdditionTime).send({ from: owner });

    // The InsuredBridgePriceFeed does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    // Construct L1 and L2 clients that we'll need to construct the pricefeed:
    rateModelStore = await RateModelStore.new().send({ from: owner });
    rateModels = {
      [l1Token.options.address]: { UBar: toWei("0.65"), R0: toWei("0.00"), R1: toWei("0.08"), R2: toWei("1.00") },
    };
    await rateModelStore.methods
      .updateRateModel(
        l1Token.options.address,
        JSON.stringify({
          UBar: rateModels[l1Token.options.address].UBar.toString(),
          R0: rateModels[l1Token.options.address].R0.toString(),
          R1: rateModels[l1Token.options.address].R1.toString(),
          R2: rateModels[l1Token.options.address].R2.toString(),
        })
      )
      .send({ from: owner });

    l1Client = new InsuredBridgeL1Client(spyLogger, web3, bridgeAdmin.options.address, rateModelStore.options.address);

    l2Client = new InsuredBridgeL2Client(spyLogger, web3, depositBox.options.address);

    // Create the InsuredBridgePriceFeed to be tested:
    pricefeed = new InsuredBridgePriceFeed({ logger: spyLogger, l1Client, l2Client });
  });
  it("Pricefeed initial setup", async function () {
    // Updating the pricefeed should also fetch state from updated clients.
    await pricefeed.update();
    assert.equal(
      JSON.stringify(pricefeed.l1Client.getBridgePoolsAddresses()),
      JSON.stringify([bridgePool.options.address])
    );
    assert.equal(JSON.stringify(pricefeed.deposits), JSON.stringify([]));
  });
  describe("Lifecycle tests", function () {
    it("Pricefeed returns 1 if the relay ancillary data correctly matches a deposit", async function () {
      // Deposit some tokens.

      await l2Token.methods.mint(depositor, toWei("200")).send({ from: owner });

      await l2Token.methods.approve(depositBox.options.address, toWei("200")).send({ from: depositor });

      // increment time for the deposit tx.
      const depositTimestamp = Number(await bridgePool.methods.getCurrentTime().call()) + 300;
      const quoteTimestamp = depositTimestamp - quoteTimestampOffset;

      await mineTransactionsAtTimeHardhat(
        network,
        [
          depositBox.methods.deposit(
            l1Recipient,
            l2Token.options.address,
            relayAmount,
            defaultSlowRelayFeePct,
            defaultInstantRelayFeePct,
            quoteTimestamp
          ),
        ],
        depositTimestamp,
        depositor
      );
      await bridgePool.methods.setCurrentTime(quoteTimestamp).send({ from: owner });

      ({ depositData, relayAncillaryData, relayData } = await generateRelayData(
        bridgePool,
        quoteTimestamp,
        depositTimestamp
      ));

      // Before relay is submitted on-chain, pricefeed returns 0:
      await pricefeed.update();
      assert.equal((await pricefeed.getHistoricalPrice(1, relayAncillaryData)).toString(), "0");

      // Relay the deposit.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams({ quoteTimestamp })).send({ from: relayer });

      // Update pricefeed and get price for relay request. Note that relay time doesn't actually matter for the
      // getHistoricalPrice method.
      await pricefeed.update();
      assert.equal((await pricefeed.getHistoricalPrice(1, relayAncillaryData)).toString(), toWei("1"));

      // If pricefeed uses an L2 client for a different network, then it will return 0.
      const otherL2Client = new InsuredBridgeL2Client(spyLogger, web3, ZERO_ADDRESS);

      // Recreate the pricefeed with new l2 client:
      pricefeed = new InsuredBridgePriceFeed({ logger: spyLogger, l1Client, l2Client: otherL2Client });
      await pricefeed.update();
      assert.equal((await pricefeed.getHistoricalPrice(1, relayAncillaryData)).toString(), "0");
      assert.isTrue(lastSpyLogIncludes(spy, "No deposit event found matching relay"));
    });
    it("Pricefeed returns 0 if incorrect ancillary data or relay time is passed into getPrice method", async function () {
      // Deposit some tokens.
      await l2Token.methods.mint(depositor, toWei("200")).send({ from: owner });
      await l2Token.methods.approve(depositBox.options.address, toWei("200")).send({ from: depositor });

      const depositTimestamp = Number(await bridgePool.methods.getCurrentTime().call()) + 300;
      const quoteTimestamp = depositTimestamp - quoteTimestampOffset;
      await mineTransactionsAtTimeHardhat(
        network,
        [
          depositBox.methods.deposit(
            l1Recipient,
            l2Token.options.address,
            relayAmount,
            defaultSlowRelayFeePct,
            defaultInstantRelayFeePct,
            quoteTimestamp
          ),
        ],
        depositTimestamp,
        depositor
      );
      await bridgePool.methods.setCurrentTime(quoteTimestamp).send({ from: owner });

      ({ depositData, relayAncillaryData, relayData } = await generateRelayData(
        bridgePool,
        quoteTimestamp,
        depositTimestamp
      ));

      // Relay the deposit to trigger a price request.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Update pricefeed and get price for relay request. Note that relay time doesn't actually matter for the
      // getHistoricalPrice method.
      await pricefeed.update();

      // Validate the stock params (nothing modified) returns 1.
      ({ depositData, relayAncillaryData, relayData } = await generateRelayData(
        bridgePool,
        quoteTimestamp,
        depositTimestamp
      ));
      assert.equal(await pricefeed.getHistoricalPrice(1, relayAncillaryData), toWei("1"));
      // Modify every param of the ancillary data to verify that the feed is checking each param.
      assert.equal(
        await pricefeed.getHistoricalPrice(
          1,
          await generateRelayAncillaryData({ ...depositData, chainId: depositData.chainId + 1 }, relayData, bridgePool)
        ),
        toWei("0")
      );
      assert.equal(
        await pricefeed.getHistoricalPrice(
          1,
          await generateRelayAncillaryData(
            { ...depositData, depositId: depositData.depositId + 1 },
            relayData,
            bridgePool
          )
        ),
        toWei("0")
      );
      assert.equal(
        await pricefeed.getHistoricalPrice(
          1,
          await generateRelayAncillaryData({ ...depositData, l1Recipient: ZERO_ADDRESS }, relayData, bridgePool)
        ),
        toWei("0")
      );
      assert.equal(
        await pricefeed.getHistoricalPrice(
          1,
          await generateRelayAncillaryData({ ...depositData, l2Sender: ZERO_ADDRESS }, relayData, bridgePool)
        ),
        toWei("0")
      );
      assert.equal(
        await pricefeed.getHistoricalPrice(
          1,
          await generateRelayAncillaryData({ ...depositData, amount: "0" }, relayData, bridgePool)
        ),
        toWei("0")
      );
      assert.equal(
        await pricefeed.getHistoricalPrice(
          1,
          await generateRelayAncillaryData({ ...depositData, slowRelayFeePct: "0" }, relayData, bridgePool)
        ),
        toWei("0")
      );
      assert.equal(
        await pricefeed.getHistoricalPrice(
          1,
          await generateRelayAncillaryData({ ...depositData, instantRelayFeePct: "0" }, relayData, bridgePool)
        ),
        toWei("0")
      );
      assert.equal(
        await pricefeed.getHistoricalPrice(
          1,
          await generateRelayAncillaryData(
            { ...depositData, quoteTimestamp: depositData.quoteTimestamp + 1 },
            relayData,
            bridgePool
          )
        ),
        toWei("0")
      );
      assert.isTrue(lastSpyLogIncludes(spy, "No relay event found matching provided ancillary data"));
    });
    it("Pricefeed returns 0 if the relay realized fee % is invalid", async function () {
      const invalidRealizedLpFeePct = toWei("0.49");
      // Deposit some tokens.
      await l2Token.methods.mint(depositor, toWei("200")).send({ from: owner });
      await l2Token.methods.approve(depositBox.options.address, toWei("200")).send({ from: depositor });

      // increment time for the deposit tx.
      const depositTimestamp = Number(await bridgePool.methods.getCurrentTime().call()) + 300;
      const quoteTimestamp = depositTimestamp - quoteTimestampOffset;
      await mineTransactionsAtTimeHardhat(
        network,
        [
          depositBox.methods.deposit(
            l1Recipient,
            l2Token.options.address,
            relayAmount,
            defaultSlowRelayFeePct,
            defaultInstantRelayFeePct,
            quoteTimestamp
          ),
        ],
        depositTimestamp,
        depositor
      );
      await bridgePool.methods.setCurrentTime(quoteTimestamp).send({ from: owner });

      ({ depositData, relayAncillaryData, relayData } = await generateRelayData(
        bridgePool,
        quoteTimestamp,
        depositTimestamp
      ));

      // Relay the deposit but modify the realized fee % to be incorrect.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          // Note: Look at BridgePool contract for max allowable realizedLpFeePct, current max is 0.5e18
          ...generateRelayParams({}, { realizedLpFeePct: invalidRealizedLpFeePct })
        )
        .send({ from: relayer });
      const modifiedRelayData = { ...relayData, realizedLpFeePct: invalidRealizedLpFeePct };
      const modifiedRelayAncillaryData = await bridgePool.methods
        .getRelayAncillaryData(depositData, modifiedRelayData)
        .call();
      // Update pricefeed and get price for relay request. Note that relay time doesn't actually matter for the
      // getHistoricalPrice method.
      await pricefeed.update();
      const price = await pricefeed.getHistoricalPrice(1, modifiedRelayAncillaryData);
      assert.equal(price, toWei("0"));
      assert.isTrue(lastSpyLogIncludes(spy, "Matched deposit realized fee % is incorrect"));
    });
    it("Pricefeed returns 0 if quote time > relay.block time", async function () {
      // Deposit some tokens.

      await l2Token.methods.mint(depositor, toWei("200")).send({ from: owner });

      await l2Token.methods.approve(depositBox.options.address, toWei("200")).send({ from: depositor });

      // Setting quote time after the latest block time will cause pricefeed to return 0.
      const depositTimestamp = Number(await bridgePool.methods.getCurrentTime().call());
      const quoteTimestamp = Number((await web3.eth.getBlock("latest")).timestamp) + 60;

      await depositBox.methods
        .deposit(
          l1Recipient,
          l2Token.options.address,
          relayAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTimestamp
        )
        .send({ from: depositor }),
        ({ depositData, relayAncillaryData, relayData } = await generateRelayData(
          bridgePool,
          quoteTimestamp,
          depositTimestamp
        ));

      // Relay the deposit.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams({ quoteTimestamp })).send({ from: relayer });

      // Update pricefeed and get price for relay request. Note that relay time doesn't actually matter for the
      // getHistoricalPrice method.
      await pricefeed.update();
      assert.equal((await pricefeed.getHistoricalPrice(1, relayAncillaryData)).toString(), toWei("0"));
    });
  });
});
