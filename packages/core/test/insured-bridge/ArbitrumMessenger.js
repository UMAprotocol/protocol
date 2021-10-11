const hre = require("hardhat");
const { web3 } = hre;
const { runDefaultFixture, ZERO_ADDRESS, didContractThrow, interfaceName } = require("@uma/common");
const { getContract } = hre;
const { utf8ToHex, toWei } = web3.utils;

const { assert } = require("chai");

const { deployContractMock } = require("./helpers/SmockitHelper");

// Tested contracts
const Arbitrum_InboxMock = getContract("Arbitrum_InboxMock");
const Arbitrum_Messenger = getContract("Arbitrum_Messenger");
const BridgeAdmin = getContract("BridgeAdmin");
const BridgePool = getContract("BridgePool");
const Timer = getContract("Timer");
const Finder = getContract("Finder");
const BridgeDepositBox = getContract("BridgeDepositBoxMock");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const ERC20 = getContract("ERC20");

// Contract objects
let arbitrumMessenger;
let bridgeAdmin;
let finder;
let l1InboxMock;
let depositBox;
let identifierWhitelist;
let collateralWhitelist;
let timer;

// Test function inputs
const defaultGasLimit = 10_000_000;
const defaultGasPrice = toWei("1", "gwei");
const defaultL1CallValue = 10_000_000_000;
const maxSubmissionCost = 10_000_000_000;
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 7200;
const defaultProposerBondPct = toWei("0.05");
const lpFeeRatePerSecond = toWei("0.0000015");
const defaultBridgingDelay = 60;
const chainId = "10";
let l1Token;
let l2Token;
let bridgePool;

describe("ArbitrumMessenger integration with BridgeAdmin", () => {
  let accounts, owner, rando, rando2, depositBoxImpersonator;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando, rando2, depositBoxImpersonator] = accounts;
    l2Token = rando2;
    await runDefaultFixture(hre);
    timer = await Timer.new().send({ from: owner });
    finder = await Finder.new().send({ from: owner });
    l1Token = (await ERC20.new("", "").send({ from: owner })).options.address;
    collateralWhitelist = await AddressWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: owner });

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: owner });

    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: owner });

    // The initialization of the bridge pool requires there to be an address of both the store and the SkinnyOptimisticOracle
    // set in the finder. These tests dont use these contracts but there are never the less needed for deployment.
    await finder.methods.changeImplementationAddress(utf8ToHex(interfaceName.Store), rando).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.SkinnyOptimisticOracle), rando)
      .send({ from: owner });
  });
  beforeEach(async function () {
    l1InboxMock = await deployContractMock("AVM_InboxMock", {}, Arbitrum_InboxMock);

    arbitrumMessenger = await Arbitrum_Messenger.new(l1InboxMock.options.address).send({ from: owner });

    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: owner });

    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token,
      lpFeeRatePerSecond,
      false, // not set to weth pool
      timer.options.address
    ).send({ from: owner });

    // Configuring the deposit box doesn't affect this test since we only check the smocked contract ABI data. But in
    // production the cross domain admin of the deposit box should be the Messenger contract, which is the msg.sender
    // of the cross chain message.
    depositBox = await BridgeDepositBox.new(
      arbitrumMessenger.options.address,
      defaultBridgingDelay,
      ZERO_ADDRESS, // weth address. Weth mode not used in these tests
      ZERO_ADDRESS // timer address
    ).send({ from: owner });
  });
  it("relayMessage basic checks", async function () {
    const relayMessageTxn = arbitrumMessenger.methods.relayMessage(
      depositBox.options.address,
      owner,
      defaultL1CallValue,
      defaultGasLimit,
      defaultGasPrice,
      maxSubmissionCost,
      "0x"
    );

    // Only callable by owner
    assert(await didContractThrow(relayMessageTxn.send({ from: rando, value: defaultL1CallValue })));
    assert.ok(await relayMessageTxn.send({ from: owner, value: defaultL1CallValue }));

    // Must set msg.value = defaultL1CallValue
    assert(await didContractThrow(relayMessageTxn.send({ from: owner, value: 0 })));
    assert.ok(await relayMessageTxn.send({ from: owner, value: defaultL1CallValue }));
  });
  describe("Cross domain Admin functions", () => {
    beforeEach(async function () {
      await arbitrumMessenger.methods.transferOwnership(bridgeAdmin.options.address).send({ from: owner });
    });
    it("Whitelist tokens", async () => {
      await bridgeAdmin.methods
        .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
        .send({ from: owner });
      await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });
      await bridgeAdmin.methods
        .whitelistToken(
          chainId,
          l1Token,
          l2Token,
          bridgePool.options.address,
          defaultL1CallValue,
          defaultGasLimit,
          defaultGasPrice,
          maxSubmissionCost
        )
        .send({ from: owner, value: defaultL1CallValue });
      const whitelistCallToMessengerCall = l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0];

      // Inbox should receive msg.value
      assert.equal((await web3.eth.getBalance(l1InboxMock.options.address)).toString(), defaultL1CallValue);

      // Validate xchain message
      assert.equal(whitelistCallToMessengerCall.destAddr, depositBoxImpersonator);
      assert.equal(whitelistCallToMessengerCall.l2CallValue, "0");
      assert.equal(whitelistCallToMessengerCall.maxSubmissionCost, maxSubmissionCost);
      assert.equal(whitelistCallToMessengerCall.excessFeeRefundAddress, owner);
      assert.equal(whitelistCallToMessengerCall.callValueRefundAddress, owner);
      assert.equal(whitelistCallToMessengerCall.maxGas, defaultGasLimit);
      assert.equal(whitelistCallToMessengerCall.gasPriceBid, defaultGasPrice);
      const expectedAbiData = depositBox.methods
        .whitelistToken(l1Token, l2Token, bridgePool.options.address)
        .encodeABI();
      assert.equal(whitelistCallToMessengerCall.data, expectedAbiData, "xchain message bytes unexpected");
    });
    it("Set bridge admin", async () => {
      await bridgeAdmin.methods
        .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
        .send({ from: owner });
      await bridgeAdmin.methods
        .setCrossDomainAdmin(chainId, rando, defaultL1CallValue, defaultGasLimit, defaultGasPrice, maxSubmissionCost)
        .send({ from: owner, value: defaultL1CallValue });
      const setAdminCallToMessengerCall = l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0];

      // Inbox should receive msg.value
      assert.equal((await web3.eth.getBalance(l1InboxMock.options.address)).toString(), defaultL1CallValue);

      // Validate xchain message
      assert.equal(setAdminCallToMessengerCall.destAddr, depositBoxImpersonator);
      assert.equal(setAdminCallToMessengerCall.l2CallValue, "0");
      assert.equal(setAdminCallToMessengerCall.maxSubmissionCost, maxSubmissionCost);
      assert.equal(setAdminCallToMessengerCall.excessFeeRefundAddress, owner);
      assert.equal(setAdminCallToMessengerCall.callValueRefundAddress, owner);
      assert.equal(setAdminCallToMessengerCall.maxGas, defaultGasLimit);
      assert.equal(setAdminCallToMessengerCall.gasPriceBid, defaultGasPrice);
      const expectedAbiData = depositBox.methods.setCrossDomainAdmin(rando).encodeABI();
      assert.equal(setAdminCallToMessengerCall.data, expectedAbiData, "xchain message bytes unexpected");
    });
    it("Set minimum bridge delay", async () => {
      await bridgeAdmin.methods
        .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
        .send({ from: owner });
      await bridgeAdmin.methods
        .setMinimumBridgingDelay(
          chainId,
          defaultBridgingDelay,
          defaultL1CallValue,
          defaultGasLimit,
          defaultGasPrice,
          maxSubmissionCost
        )
        .send({ from: owner, value: defaultL1CallValue });
      const setDelayCallToMessengerCall = l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0];

      // Inbox should receive msg.value
      assert.equal((await web3.eth.getBalance(l1InboxMock.options.address)).toString(), defaultL1CallValue);

      // Validate xchain message
      assert.equal(setDelayCallToMessengerCall.destAddr, depositBoxImpersonator);
      assert.equal(setDelayCallToMessengerCall.l2CallValue, "0");
      assert.equal(setDelayCallToMessengerCall.maxSubmissionCost, maxSubmissionCost);
      assert.equal(setDelayCallToMessengerCall.excessFeeRefundAddress, owner);
      assert.equal(setDelayCallToMessengerCall.callValueRefundAddress, owner);
      assert.equal(setDelayCallToMessengerCall.maxGas, defaultGasLimit);
      assert.equal(setDelayCallToMessengerCall.gasPriceBid, defaultGasPrice);
      const expectedAbiData = depositBox.methods.setMinimumBridgingDelay(defaultBridgingDelay).encodeABI();
      assert.equal(setDelayCallToMessengerCall.data, expectedAbiData, "xchain message bytes unexpected");
    });
    it("Pause deposits", async () => {
      await bridgeAdmin.methods
        .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
        .send({ from: owner });
      await bridgeAdmin.methods
        .setEnableDeposits(
          chainId,
          l2Token,
          false,
          defaultL1CallValue,
          defaultGasLimit,
          defaultGasPrice,
          maxSubmissionCost
        )
        .send({ from: owner, value: defaultL1CallValue });
      const setPauseCallToMessengerCall = l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0];

      // Inbox should receive msg.value
      assert.equal((await web3.eth.getBalance(l1InboxMock.options.address)).toString(), defaultL1CallValue);

      // Validate xchain message
      assert.equal(setPauseCallToMessengerCall.destAddr, depositBoxImpersonator);
      assert.equal(setPauseCallToMessengerCall.l2CallValue, "0");
      assert.equal(setPauseCallToMessengerCall.maxSubmissionCost, maxSubmissionCost);
      assert.equal(setPauseCallToMessengerCall.excessFeeRefundAddress, owner);
      assert.equal(setPauseCallToMessengerCall.callValueRefundAddress, owner);
      assert.equal(setPauseCallToMessengerCall.maxGas, defaultGasLimit);
      assert.equal(setPauseCallToMessengerCall.gasPriceBid, defaultGasPrice);
      const expectedAbiData = depositBox.methods.setEnableDeposits(l2Token, false).encodeABI();
      assert.equal(setPauseCallToMessengerCall.data, expectedAbiData, "xchain message bytes unexpected");
    });
  });
});
