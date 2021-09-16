const hre = require("hardhat");
const { web3 } = require("hardhat");
const { predeploys } = require("@eth-optimism/contracts");
const { interfaceName, TokenRolesEnum, InsuredBridgeRelayStateEnum, ZERO_ADDRESS } = require("@uma/common");
const { SpyTransport, lastSpyLogIncludes } = require("../../dist/logger/SpyTransport");
const sinon = require("sinon");
const { getContract } = hre;
const { utf8ToHex, toWei, toBN, soliditySha3 } = web3.utils;

// TODO: refactor to common util
const { deployOptimismContractMock } = require("../../../core/test/insured-bridge/helpers/SmockitHelper");

const winston = require("winston");
const { assert } = require("chai");

const BridgeAdmin = getContract("BridgeAdmin");
const BridgePool = getContract("BridgePool");
const BridgeDepositBox = getContract("OVM_BridgeDepositBox");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("OptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");

// Pricefeed to test
const { InsuredBridgePriceFeed } = require("../../dist/price-feed/InsuredBridgePriceFeed");
const { InsuredBridgeL1Client } = require("../../dist/clients/InsuredBridgeL1Client");
const { InsuredBridgeL2Client } = require("../../dist/clients/InsuredBridgeL2Client");

// Contract objects
let bridgeAdmin, bridgePool;

// Tested clients
let pricefeed;
let l1Client;
let l2Client;
let spy;

let finder,
  store,
  identifierWhitelist,
  collateralWhitelist,
  l1CrossDomainMessengerMock,
  l2CrossDomainMessengerMock,
  depositBox,
  timer,
  optimisticOracle,
  l1Token,
  l2Token,
  depositData,
  relayData,
  depositDataAbiEncoded,
  depositHash,
  relayAncillaryData,
  relayAncillaryDataHash;

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
const defaultGasLimit = 1_000_000;
const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const quoteTimestampOffset = 60; // 60 seconds into the past.

describe("InsuredBridgePriceFeed", function () {
  let accounts, owner, depositor, relayer, liquidityProvider, l1Recipient;

  const generateRelayParams = (depositDataOverride = {}, relayDataOverride = {}) => {
    const _depositData = { ...depositData, ...depositDataOverride };
    const _relayData = { ...relayData, ...relayDataOverride };
    // Remove the l1Token. This is part of the deposit data (hash) but is not part of the params for relayDeposit.
    // eslint-disable-next-line no-unused-vars
    const { l1Token, ...params } = _depositData;
    return [...Object.values(params), _relayData.realizedLpFeePct];
  };

  const generateRelayAncillaryData = async (depositData, relayData, bridgePool) => {
    return await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call();
  };

  const generateRelayData = async (depositData, relayData, bridgePool) => {
    // Save other reused values.
    depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint8", "uint64", "address", "address", "address", "uint256", "uint64", "uint64", "uint64"],
      [
        depositData.chainId,
        depositData.depositId,
        depositData.l1Recipient,
        depositData.l2Sender,
        depositData.l1Token,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
      ]
    );
    depositHash = soliditySha3(depositDataAbiEncoded);
    relayAncillaryData = await generateRelayAncillaryData(depositData, relayData, bridgePool);
    relayAncillaryDataHash = soliditySha3(relayAncillaryData);
    return { depositHash, relayAncillaryData, relayAncillaryDataHash };
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, depositor, relayer, liquidityProvider, l1Recipient] = accounts;

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
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: owner });

    // Set up the Insured bridge contracts.

    // Deploy and setup BridgeAdmin
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
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
      timer.options.address
    ).send({ from: owner });

    // Deploy L2 deposit contract:
    // Initialize the cross domain massager messenger mock at the address of the OVM pre-deploy. The OVM will always use
    // this address for L1<->L2 messaging. Seed this address with some funds so it can send transactions.
    l2CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L2CrossDomainMessenger", {
      address: predeploys.OVM_L2CrossDomainMessenger,
    });
    await web3.eth.sendTransaction({ from: owner, to: predeploys.OVM_L2CrossDomainMessenger, value: toWei("1") });

    depositBox = await BridgeDepositBox.new(
      bridgeAdmin.options.address,
      minimumBridgingDelay,
      timer.options.address
    ).send({ from: owner });

    l2Token = await ERC20.new("L2 Wrapped Ether", "WETH", 18).send({ from: owner });
    await l2Token.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });

    // Whitelist the token in the deposit box.
    l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin.options.address);
    await depositBox.methods
      .whitelistToken(l1Token.options.address, l2Token.options.address, bridgePool.options.address)
      .send({ from: predeploys.OVM_L2CrossDomainMessenger });

    // Connect L1 and L2 contracts:
    await bridgeAdmin.methods.setDepositContract(depositBox.options.address).send({ from: owner });

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(l1Token.options.address, l2Token.options.address, bridgePool.options.address, defaultGasLimit)
      .send({ from: owner });

    // Add some liquidity to the pool to facilitate bridging actions.
    await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
    await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });

    // The InsuredBridgePriceFeed does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    spy = sinon.spy();
    const spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    // Construct L1 and L2 clients that we'll need to construct the pricefeed:
    l1Client = new InsuredBridgeL1Client(spyLogger, web3, bridgeAdmin.options.address);
    l2Client = new InsuredBridgeL2Client(spyLogger, web3, depositBox.options.address);

    // Create the InsuredBridgePriceFeed to be tested:
    pricefeed = new InsuredBridgePriceFeed({ logger: spyLogger, l1Client, l2Client });

    // Create some data for initial relay.

    // Store expected relay data that we'll use to verify contract state:
    const expectedDepositTimestamp = Number(await optimisticOracle.methods.getCurrentTime().call());
    depositData = {
      chainId: 10,
      depositId: 0,
      l1Recipient: l1Recipient,
      l2Sender: depositor,
      l1Token: l1Token.options.address,
      amount: relayAmount,
      slowRelayFeePct: defaultSlowRelayFeePct,
      instantRelayFeePct: defaultInstantRelayFeePct,
      quoteTimestamp: expectedDepositTimestamp + quoteTimestampOffset,
    };
    relayData = {
      relayId: 0,
      relayState: InsuredBridgeRelayStateEnum.UNINITIALIZED,
      priceRequestTime: expectedDepositTimestamp,
      // This should match the realized fee % that the L1 client computes, otherwise the pricefeed will determine the
      // relay to be invalid.
      realizedLpFeePct: (await l1Client.calculateRealizedLpFeePctForDeposit(depositData)).toString(),
      slowRelayer: relayer,
      instantRelayer: ZERO_ADDRESS,
    };
    ({ depositHash, relayAncillaryData, relayAncillaryDataHash } = await generateRelayData(
      depositData,
      relayData,
      bridgePool
    ));
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
      const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) + quoteTimestampOffset;
      await depositBox.methods
        .deposit(
          l1Recipient,
          l2Token.options.address,
          relayAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTimestamp
        )
        .send({ from: depositor });

      // Relay the deposit to trigger a price request.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Update pricefeed and get price for relay request. Note that relay time doesn't actually matter for the
      // getHistoricalPrice method.
      await pricefeed.update();
      const price = await pricefeed.getHistoricalPrice(1, relayAncillaryData);
      assert.equal(price, toWei("1"));
    });
    it("Pricefeed returns 0 if incorrect ancillary data or relay time is passed into getPrice method", async function () {
      // Deposit some tokens.
      await l2Token.methods.mint(depositor, toWei("200")).send({ from: owner });
      await l2Token.methods.approve(depositBox.options.address, toWei("200")).send({ from: depositor });
      const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) + quoteTimestampOffset;
      await depositBox.methods
        .deposit(
          l1Recipient,
          l2Token.options.address,
          relayAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTimestamp
        )
        .send({ from: depositor });

      // Relay the deposit to trigger a price request.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Update pricefeed and get price for relay request. Note that relay time doesn't actually matter for the
      // getHistoricalPrice method.
      await pricefeed.update();
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
          await generateRelayAncillaryData({ ...depositData, l1Token: ZERO_ADDRESS }, relayData, bridgePool)
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
      assert.isTrue(lastSpyLogIncludes(spy, "No deposit event found matching relay request ancillary data and time"));
    });
    it("Pricefeed returns 0 if the relay realized fee % is invalid", async function () {
      // Deposit some tokens.
      await l2Token.methods.mint(depositor, toWei("200")).send({ from: owner });
      await l2Token.methods.approve(depositBox.options.address, toWei("200")).send({ from: depositor });
      const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) + quoteTimestampOffset;
      await depositBox.methods
        .deposit(
          l1Recipient,
          l2Token.options.address,
          relayAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTimestamp
        )
        .send({ from: depositor });

      // Relay the deposit but modify the realized fee % to be incorrect.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          // Note: Look at BridgePool contract for max allowable realizedLpFeePct, current max is 0.5e18
          ...generateRelayParams({}, { realizedLpFeePct: toWei("0.49") })
        )
        .send({ from: relayer });
      const modifiedRelayData = { ...relayData, realizedLpFeePct: toWei("0.49") };
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
  });
});
