const hre = require("hardhat");
const { web3 } = require("hardhat");
const { interfaceName, TokenRolesEnum, InsuredBridgeRelayStateEnum, ZERO_ADDRESS } = require("@uma/common");
const { getContract } = hre;
const { utf8ToHex, toWei, toBN, soliditySha3 } = web3.utils;

// TODO: refactor to common util
const { deployOptimismContractMock } = require("../../../core/test/insured-bridge/helpers/SmockitHelper");

const winston = require("winston");
const { assert } = require("chai");

const BridgeAdmin = getContract("BridgeAdmin");
const BridgePool = getContract("BridgePool");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("OptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");
const MockOracle = getContract("MockOracleAncillary");

// Client to test
const { InsuredBridgeL1Client } = require("../../dist/clients/InsuredBridgeL1Client");

// tested client
let client;

// Contract objects
let bridgeAdmin, bridgePool;

let finder,
  store,
  identifierWhitelist,
  collateralWhitelist,
  l1CrossDomainMessengerMock,
  timer,
  optimisticOracle,
  l1Token,
  mockOracle,
  depositData,
  relayData,
  depositDataAbiEncoded,
  depositHash,
  relayAncillaryData,
  relayAncillaryDataHash,
  expectedRelayedDepositInformation;

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

describe("InsuredBridgeL1Client", function () {
  let accounts,
    owner,
    depositContractImpersonator,
    depositor,
    relayer,
    instantRelayer,
    liquidityProvider,
    recipient,
    l2Token,
    disputer,
    rando;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [
      owner,
      depositContractImpersonator,
      depositor,
      relayer,
      instantRelayer,
      liquidityProvider,
      recipient,
      l2Token,
      disputer,
      rando,
    ] = accounts;

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

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
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

    await bridgeAdmin.methods.setDepositContract(depositContractImpersonator).send({ from: owner });

    // Deploy a bridgePool and whitelist it.
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      timer.options.address
    ).send({ from: owner });

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(l1Token.options.address, l2Token, bridgePool.options.address, defaultGasLimit)
      .send({ from: owner });

    // Add some liquidity to the pool to facilitate bridging actions.
    await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
    await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });

    // Create the InsuredBridgeL1Client to be tested.

    // The InsuredBridgeL1Client does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    client = new InsuredBridgeL1Client(dummyLogger, BridgeAdmin.abi, BridgePool.abi, web3, bridgeAdmin.options.address);

    // Create some data for relay the initial relay action.

    // Store expected relay data that we'll use to verify contract state:
    depositData = {
      depositId: 1,
      depositTimestamp: (await optimisticOracle.methods.getCurrentTime().call()).toString(),
      l2Sender: depositor,
      recipient: recipient,
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

    // Save other reused values.
    depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint64", "uint64", "address", "address", "address", "uint256", "uint64", "uint64", "uint64"],
      [
        depositData.depositId,
        depositData.depositTimestamp,
        depositData.l2Sender,
        depositData.recipient,
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

    expectedRelayedDepositInformation = {
      depositId: depositData.depositId,
      sender: depositData.l2Sender,
      slowRelayer: relayer,
      disputedSlowRelayers: [],
      instantRelayer: ZERO_ADDRESS, // not sped up so should be 0x000...
      depositTimestamp: depositData.depositTimestamp,
      recipient: depositData.recipient,
      l1Token: l1Token.options.address,
      amount: depositData.amount,
      slowRelayFeePct: depositData.slowRelayFeePct,
      instantRelayFeePct: depositData.instantRelayFeePct,
      realizedLpFeePct: relayData.realizedLpFeePct,
      priceRequestAncillaryDataHash: relayAncillaryDataHash,
      depositHash: depositHash,
      depositContract: depositContractImpersonator,
      relayState: 0, // pending
    };
  });

  it("Client initial setup", async function () {
    // Before the client is updated, client should error out.
    assert.throws(client.getBridgePoolsAddresses, Error);

    // After updating the client it should contain the appropriate addresses.
    await client.update();
    assert.equal(JSON.stringify(client.getBridgePoolsAddresses()), JSON.stringify([bridgePool.options.address]));
  });
  it("Relayed deposits: deposit, speedup finalize lifecycle", async function () {
    // Before relay should contain no data.
    await client.update();

    // After relaying a deposit, should contain the exacted data.
    const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));

    await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
    await bridgePool.methods
      .relayDeposit(
        depositData.depositId,
        depositData.depositTimestamp,
        depositData.recipient,
        depositData.l2Sender,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
        relayData.realizedLpFeePct
      )
      .send({ from: relayer });

    const relayStatus = await bridgePool.methods.relays(depositHash).call();

    await client.update();

    // As there is only one L1Token that has been set up with the bridge, getAllRelayedDeposits and getRelayedDepositsForL1Token
    // should both return the same thing. This should correspond to the expected data.
    assert.equal(
      JSON.stringify(client.getAllRelayedDeposits()),
      JSON.stringify(client.getRelayedDepositsForL1Token(l1Token.options.address))
    );

    assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));

    // Next, speed up the relay and check the client updates accordingly.
    const instantRelayAmountSubFee = toBN(relayAmount)
      .sub(
        toBN(defaultRealizedLpFee)
          .mul(toBN(relayAmount))
          .div(toBN(toWei("1")))
      )
      .sub(
        toBN(defaultSlowRelayFeePct)
          .mul(toBN(relayAmount))
          .div(toBN(toWei("1")))
      )
      .sub(
        toBN(defaultInstantRelayFeePct)
          .mul(toBN(relayAmount))
          .div(toBN(toWei("1")))
      )
      .toString();

    await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, instantRelayAmountSubFee).send({ from: instantRelayer });
    await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

    await client.update();

    // After the fast relay, there should be an instant relayer set and the relayState should be updated.
    expectedRelayedDepositInformation.instantRelayer = instantRelayer;
    expectedRelayedDepositInformation.relayState = 1; // sped up

    assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));

    // Next, advance time and settle the relay. State should update accordingly.
    await timer.methods
      .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + defaultLiveness)
      .send({ from: owner });
    await optimisticOracle.methods
      .settle(
        bridgePool.options.address,
        defaultIdentifier,
        relayStatus.priceRequestTime.toString(),
        relayAncillaryData
      )
      .send({ from: relayer });

    // Settle relay.
    await bridgePool.methods.settleRelay(depositData).send({ from: rando });

    await client.update();
    expectedRelayedDepositInformation.relayState = 3; // settled
    assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
  });
  it("Relayed deposits: deposit, speedup dispute lifecycle", async function () {
    // Before relay should contain no data.
    await client.update();

    // After relaying a deposit, should contain the exacted data.
    const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));

    await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
    await bridgePool.methods
      .relayDeposit(
        depositData.depositId,
        depositData.depositTimestamp,
        depositData.recipient,
        depositData.l2Sender,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
        relayData.realizedLpFeePct
      )
      .send({ from: relayer });

    const relayStatus = await bridgePool.methods.relays(depositHash).call();

    await client.update();

    // As there is only one L1Token that has been set up with the bridge, getAllRelayedDeposits and getRelayedDepositsForL1Token
    // should both return the same thing. This should correspond to the expected data.
    assert.equal(
      JSON.stringify(client.getAllRelayedDeposits()),
      JSON.stringify(client.getRelayedDepositsForL1Token(l1Token.options.address))
    );

    assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
    // Next, speed up the relay and check the client updates accordingly.
    const instantRelayAmountSubFee = toBN(relayAmount)
      .sub(
        toBN(defaultRealizedLpFee)
          .mul(toBN(relayAmount))
          .div(toBN(toWei("1")))
      )
      .sub(
        toBN(defaultSlowRelayFeePct)
          .mul(toBN(relayAmount))
          .div(toBN(toWei("1")))
      )
      .sub(
        toBN(defaultInstantRelayFeePct)
          .mul(toBN(relayAmount))
          .div(toBN(toWei("1")))
      )
      .toString();

    await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, instantRelayAmountSubFee).send({ from: instantRelayer });
    await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

    await client.update();

    // After the fast relay, there should be an instant relayer set and the relayState should be updated.
    expectedRelayedDepositInformation.instantRelayer = instantRelayer;
    expectedRelayedDepositInformation.relayState = 1; // sped up

    assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));

    // Next, dispute the relay. The state should update accordingly in the client.
    await timer.methods.setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + 1).send({ from: owner });
    await l1Token.methods.mint(disputer, totalRelayBond).send({ from: owner });
    await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
    await optimisticOracle.methods
      .disputePrice(
        bridgePool.options.address,
        defaultIdentifier,
        relayStatus.priceRequestTime.toString(),
        relayAncillaryData
      )
      .send({ from: disputer });

    await client.update();
    expectedRelayedDepositInformation.relayState = 2; // disputed
    assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));

    // Can re-relay the deposit.
    await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
    // Cache price request timestamp.

    await bridgePool.methods
      .relayDeposit(
        depositData.depositId,
        depositData.depositTimestamp,
        depositData.recipient,
        depositData.l2Sender,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
        relayData.realizedLpFeePct
      )
      .send({ from: rando });

    // Check the client updated accordingly. Importantly there should be a new slow relayer, the disputed slow relayers
    // should contain the previous relayer.
    await client.update();
    expectedRelayedDepositInformation.slowRelayer = rando; // The re-relayer was the rando account.
    expectedRelayedDepositInformation.disputedSlowRelayers.push(relayer); // disputed
    assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
  });
});
