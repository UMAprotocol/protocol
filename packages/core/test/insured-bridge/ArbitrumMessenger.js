const hre = require("hardhat");
const { runDefaultFixture, ZERO_ADDRESS, didContractThrow } = require("@uma/common");
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
const defaultGasLimit = 1_000_000;
const defaultGasPrice = toWei("1", "gwei");
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
    l1Token = rando;
    l2Token = rando2;
    await runDefaultFixture(hre);
    timer = await Timer.deployed();
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: owner });
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
      timer.options.address
    ).send({ from: owner });

    depositBox = await BridgeDepositBox.new(bridgeAdmin.options.address, defaultBridgingDelay, ZERO_ADDRESS).send({
      from: owner,
    });
  });
  it("relayMessage only callable by owner", async function () {
    const relayMessageTxn = arbitrumMessenger.methods.relayMessage(
      depositBox.options.address,
      defaultGasLimit,
      defaultGasPrice,
      "0x"
    );
    assert(await didContractThrow(relayMessageTxn.send({ from: rando })));
    assert.ok(await relayMessageTxn.send({ from: owner }));
  });
  describe("Cross domain Admin functions", () => {
    beforeEach(async function () {
      await arbitrumMessenger.methods.transferOwnership(bridgeAdmin.options.address).send({ from: owner });
    });
    describe("Whitelist tokens", () => {
      it("Sends xchain message", async () => {
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
          .send({ from: owner });
        await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });
        await bridgeAdmin.methods
          .whitelistToken(chainId, l1Token, l2Token, bridgePool.options.address, defaultGasLimit, defaultGasPrice)
          .send({ from: owner });
        const whitelistCallToMessengerCall = l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0];

        // Validate xchain message
        assert.equal(whitelistCallToMessengerCall.destAddr, depositBoxImpersonator);
        assert.equal(whitelistCallToMessengerCall.l2CallValue, "0");
        assert.equal(whitelistCallToMessengerCall.maxSubmissionCost, "0");
        assert.equal(whitelistCallToMessengerCall.excessFeeRefundAddress, depositBoxImpersonator);
        assert.equal(whitelistCallToMessengerCall.callValueRefundAddress, depositBoxImpersonator);
        assert.equal(whitelistCallToMessengerCall.maxGas, defaultGasLimit);
        assert.equal(whitelistCallToMessengerCall.gasPriceBid, defaultGasPrice);
        const expectedAbiData = depositBox.methods
          .whitelistToken(l1Token, l2Token, bridgePool.options.address)
          .encodeABI();
        assert.equal(whitelistCallToMessengerCall.data, expectedAbiData, "xchain message bytes unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
          .send({ from: owner });
        await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });
        await bridgeAdmin.methods
          .whitelistToken(chainId, l1Token, l2Token, bridgePool.options.address, customGasLimit, defaultGasPrice)
          .send({ from: owner });
        const whitelistCallToMessengerCall = l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0];
        assert.equal(whitelistCallToMessengerCall.maxGas, customGasLimit, "xchain gas limit unexpected");
      });
    });
    describe("Set bridge admin", () => {
      it("Changes admin address", async () => {
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setBridgeAdmin(chainId, rando, defaultGasLimit, defaultGasPrice)
          .send({ from: owner });
        const setAdminCallToMessengerCall = l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0];

        // Validate xchain message
        assert.equal(setAdminCallToMessengerCall.destAddr, depositBoxImpersonator);
        assert.equal(setAdminCallToMessengerCall.l2CallValue, "0");
        assert.equal(setAdminCallToMessengerCall.maxSubmissionCost, "0");
        assert.equal(setAdminCallToMessengerCall.excessFeeRefundAddress, depositBoxImpersonator);
        assert.equal(setAdminCallToMessengerCall.callValueRefundAddress, depositBoxImpersonator);
        assert.equal(setAdminCallToMessengerCall.maxGas, defaultGasLimit);
        assert.equal(setAdminCallToMessengerCall.gasPriceBid, defaultGasPrice);
        const expectedAbiData = depositBox.methods.setBridgeAdmin(rando).encodeABI();
        assert.equal(setAdminCallToMessengerCall.data, expectedAbiData, "xchain message bytes unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods.setBridgeAdmin(chainId, rando, customGasLimit, defaultGasPrice).send({ from: owner });
        assert.equal(
          l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0].maxGas,
          customGasLimit,
          "xchain gas limit unexpected"
        );
      });
    });
    describe("Set minimum bridge delay", () => {
      it("Sets delay", async () => {
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setMinimumBridgingDelay(chainId, defaultBridgingDelay, defaultGasLimit, defaultGasPrice)
          .send({ from: owner });
        const setDelayCallToMessengerCall = l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0];

        // Validate xchain message
        assert.equal(setDelayCallToMessengerCall.destAddr, depositBoxImpersonator);
        assert.equal(setDelayCallToMessengerCall.l2CallValue, "0");
        assert.equal(setDelayCallToMessengerCall.maxSubmissionCost, "0");
        assert.equal(setDelayCallToMessengerCall.excessFeeRefundAddress, depositBoxImpersonator);
        assert.equal(setDelayCallToMessengerCall.callValueRefundAddress, depositBoxImpersonator);
        assert.equal(setDelayCallToMessengerCall.maxGas, defaultGasLimit);
        assert.equal(setDelayCallToMessengerCall.gasPriceBid, defaultGasPrice);
        const expectedAbiData = depositBox.methods.setMinimumBridgingDelay(defaultBridgingDelay).encodeABI();
        assert.equal(setDelayCallToMessengerCall.data, expectedAbiData, "xchain message bytes unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setMinimumBridgingDelay(chainId, defaultBridgingDelay, customGasLimit, defaultGasPrice)
          .send({ from: owner });
        assert.equal(
          l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0].maxGas,
          customGasLimit,
          "xchain gas limit unexpected"
        );
      });
    });
    describe("Pause deposits", () => {
      it("Sets boolean value", async () => {
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setEnableDeposits(chainId, l2Token, false, defaultGasLimit, defaultGasPrice)
          .send({ from: owner });
        const setPauseCallToMessengerCall = l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0];

        // Validate xchain message
        assert.equal(setPauseCallToMessengerCall.destAddr, depositBoxImpersonator);
        assert.equal(setPauseCallToMessengerCall.l2CallValue, "0");
        assert.equal(setPauseCallToMessengerCall.maxSubmissionCost, "0");
        assert.equal(setPauseCallToMessengerCall.excessFeeRefundAddress, depositBoxImpersonator);
        assert.equal(setPauseCallToMessengerCall.callValueRefundAddress, depositBoxImpersonator);
        assert.equal(setPauseCallToMessengerCall.maxGas, defaultGasLimit);
        assert.equal(setPauseCallToMessengerCall.gasPriceBid, defaultGasPrice);
        const expectedAbiData = depositBox.methods.setEnableDeposits(l2Token, false).encodeABI();
        assert.equal(setPauseCallToMessengerCall.data, expectedAbiData, "xchain message bytes unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, arbitrumMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setEnableDeposits(chainId, l2Token, false, customGasLimit, defaultGasPrice)
          .send({ from: owner });
        assert.equal(
          l1InboxMock.smocked.createRetryableTicketNoRefundAliasRewrite.calls[0].maxGas,
          customGasLimit,
          "xchain gas limit unexpected"
        );
      });
    });
  });
});
