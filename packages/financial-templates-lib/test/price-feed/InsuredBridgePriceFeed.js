const hre = require("hardhat");
const { web3 } = require("hardhat");
const { predeploys } = require("@eth-optimism/contracts");
const { interfaceName, TokenRolesEnum, InsuredBridgeRelayStateEnum, ZERO_ADDRESS } = require("@uma/common");
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
const defaultRealizedLpFee = toWei("0.1");
const defaultInstantRelayFeePct = toWei("0.01");
const defaultQuoteTimestamp = 100000;
const lpFeeRatePerSecond = toWei("0.0000015");
const finalFee = toWei("1");
const defaultGasLimit = 1_000_000;
const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const quoteTimestampOffset = 60; // 60 seconds into the past.

describe("InsuredBridgePriceFeed", function () {
  let accounts, owner, depositor, relayer, liquidityProvider, recipient;

  const generateRelayParams = (depositDataOverride = {}, relayDataOverride = {}) => {
    const _depositData = { ...depositData, ...depositDataOverride };
    const _relayData = { ...relayData, ...relayDataOverride };
    // Remove the l1Token. This is part of the deposit data (hash) but is not part of the params for relayDeposit.
    // eslint-disable-next-line no-unused-vars
    const { l1Token, ...params } = _depositData;
    return [...Object.values(params), _relayData.realizedLpFeePct];
  };

  const generateRelayData = async (depositData, relayData, bridgePool) => {
    // Save other reused values.
    depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint64", "uint64", "address", "address", "address", "uint256", "uint64", "uint64", "uint64"],
      [
        depositData.depositId,
        depositData.depositTimestamp,
        depositData.recipient,
        depositData.l2Sender,
        depositData.l1Token,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
      ]
    );
    depositHash = soliditySha3(depositDataAbiEncoded);
    relayAncillaryData = await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call();
    relayAncillaryDataHash = soliditySha3(relayAncillaryData);
    return { depositHash, relayAncillaryData, relayAncillaryDataHash };
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, depositor, relayer, liquidityProvider, recipient] = accounts;

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
    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    // Construct L1 and L2 clients that we'll need to construct the pricefeed:
    l1Client = new InsuredBridgeL1Client(
      dummyLogger,
      BridgeAdmin.abi,
      BridgePool.abi,
      web3,
      bridgeAdmin.options.address
    );
    l2Client = new InsuredBridgeL2Client(dummyLogger, BridgeDepositBox.abi, web3, depositBox.options.address);

    // Create the InsuredBridgePriceFeed to be tested:
    pricefeed = new InsuredBridgePriceFeed({ logger: dummyLogger, web3, l1Client, l2Client });

    // Create some data for initial relay.

    // Store expected relay data that we'll use to verify contract state:
    depositData = {
      depositId: 1,
      depositTimestamp: (await optimisticOracle.methods.getCurrentTime().call()).toString(),
      recipient: recipient,
      l2Sender: depositor,
      l1Token: l1Token.options.address,
      amount: relayAmount,
      slowRelayFeePct: defaultSlowRelayFeePct,
      instantRelayFeePct: defaultInstantRelayFeePct,
      quoteTimestamp: defaultQuoteTimestamp,
    };
    relayData = {
      relayState: InsuredBridgeRelayStateEnum.UNINITIALIZED,
      priceRequestTime: 0,
      realizedLpFeePct: defaultRealizedLpFee,
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
    // Updating the pricefeed should also update the L1/L2 clients.
    await pricefeed.update();
    assert.equal(
      JSON.stringify(pricefeed.l1Client.getBridgePoolsAddresses()),
      JSON.stringify([bridgePool.options.address])
    );
    assert.equal(JSON.stringify(pricefeed.l2Client.getAllDeposits()), JSON.stringify([]));
  });
  describe("Lifecycle tests", function () {
    it("Pricefeed can parse ancillary data from relay price request", async function () {
      // Deposit some tokens.
      await l2Token.methods.mint(depositor, toWei("200")).send({ from: owner });
      await l2Token.methods.approve(depositBox.options.address, toWei("200")).send({ from: depositor });
      const depositTimestamp = Number(await timer.methods.getCurrentTime().call());
      const quoteTimestamp = depositTimestamp + quoteTimestampOffset;
      await depositBox.methods
        .deposit(
          recipient,
          l2Token.options.address,
          relayAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTimestamp
        )
        .send({ from: depositor });

      // Relay the deposit.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      const relayTime = Number((await optimisticOracle.methods.getCurrentTime().call()).toString());
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Update pricefeed and get price for relay request:
      await pricefeed.update();
      await pricefeed.getHistoricalPrice(relayTime);

      // Throw error if request can't be found:
      // assert.throws(await pricefeed.getHistoricalPrice(relayTime+1))
    });
  });
});
