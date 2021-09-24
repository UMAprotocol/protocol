const hre = require("hardhat");
const { runDefaultFixture, ZERO_ADDRESS } = require("@uma/common");
const { getContract } = hre;
const { utf8ToHex, toWei } = web3.utils;

const { deployOptimismContractMock } = require("./helpers/SmockitHelper");

const { assert } = require("chai");

// Tested contracts
const OptimismMessenger = getContract("OptimismMessenger");
const BridgeAdmin = getContract("BridgeAdmin");
const BridgePool = getContract("BridgePool");
const Timer = getContract("Timer");
const Finder = getContract("Finder");
const BridgeDepositBox = getContract("BridgeDepositBoxMock");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");

// Contract objects
let optimismMessenger;
let bridgeAdmin;
let finder;
let l1CrossDomainMessengerMock;
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

describe("OptimismMessenger integration with BridgeAdmin", () => {
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
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");

    optimismMessenger = await OptimismMessenger.new(l1CrossDomainMessengerMock.options.address).send({ from: owner });

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
  describe("Cross domain Admin functions", () => {
    describe("Whitelist tokens", () => {
      it("Sends xchain message", async () => {
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, optimismMessenger.options.address)
          .send({ from: owner });
        await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });
        await bridgeAdmin.methods
          .whitelistToken(chainId, l1Token, l2Token, bridgePool.options.address, defaultGasLimit, defaultGasPrice)
          .send({ from: owner });
        const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

        // Validate xchain message
        assert.equal(
          whitelistCallToMessengerCall._target,
          depositBoxImpersonator,
          "xchain target should be deposit contract"
        );
        const expectedAbiData = depositBox.methods
          .whitelistToken(l1Token, l2Token, bridgePool.options.address)
          .encodeABI();
        assert.equal(whitelistCallToMessengerCall._message, expectedAbiData, "xchain message bytes unexpected");
        assert.equal(whitelistCallToMessengerCall._gasLimit, defaultGasLimit, "xchain gas limit unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, optimismMessenger.options.address)
          .send({ from: owner });
        await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });
        await bridgeAdmin.methods
          .whitelistToken(chainId, l1Token, l2Token, bridgePool.options.address, customGasLimit, defaultGasPrice)
          .send({ from: owner });
        const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];
        assert.equal(whitelistCallToMessengerCall._gasLimit, customGasLimit, "xchain gas limit unexpected");
      });
    });
    describe("Set bridge admin", () => {
      it("Changes admin address", async () => {
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, optimismMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setBridgeAdmin(chainId, rando, defaultGasLimit, defaultGasPrice)
          .send({ from: owner });
        const setAdminCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

        // Validate xchain message
        assert.equal(
          setAdminCallToMessengerCall._target,
          depositBoxImpersonator,
          "xchain target should be deposit contract"
        );
        const expectedAbiData = depositBox.methods.setBridgeAdmin(rando).encodeABI();
        assert.equal(setAdminCallToMessengerCall._message, expectedAbiData, "xchain message bytes unexpected");
        assert.equal(setAdminCallToMessengerCall._gasLimit, defaultGasLimit, "xchain gas limit unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, optimismMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods.setBridgeAdmin(chainId, rando, customGasLimit, defaultGasPrice).send({ from: owner });
        assert.equal(
          l1CrossDomainMessengerMock.smocked.sendMessage.calls[0]._gasLimit,
          customGasLimit,
          "xchain gas limit unexpected"
        );
      });
    });
    describe("Set minimum bridge delay", () => {
      it("Sets delay", async () => {
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, optimismMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setMinimumBridgingDelay(chainId, defaultBridgingDelay, defaultGasLimit, defaultGasPrice)
          .send({ from: owner });
        const setDelayCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

        // Validate xchain message
        assert.equal(
          setDelayCallToMessengerCall._target,
          depositBoxImpersonator,
          "xchain target should be deposit contract"
        );
        const expectedAbiData = depositBox.methods.setMinimumBridgingDelay(defaultBridgingDelay).encodeABI();
        assert.equal(setDelayCallToMessengerCall._message, expectedAbiData, "xchain message bytes unexpected");
        assert.equal(setDelayCallToMessengerCall._gasLimit, defaultGasLimit, "xchain gas limit unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, optimismMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setMinimumBridgingDelay(chainId, defaultBridgingDelay, customGasLimit, defaultGasPrice)
          .send({ from: owner });
        assert.equal(
          l1CrossDomainMessengerMock.smocked.sendMessage.calls[0]._gasLimit,
          customGasLimit,
          "xchain gas limit unexpected"
        );
      });
    });
    describe("Pause deposits", () => {
      it("Sets boolean value", async () => {
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, optimismMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setEnableDeposits(chainId, l2Token, false, defaultGasLimit, defaultGasPrice)
          .send({ from: owner });
        const setDelayCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

        // Validate xchain message
        assert.equal(
          setDelayCallToMessengerCall._target,
          depositBoxImpersonator,
          "xchain target should be deposit contract"
        );
        const expectedAbiData = depositBox.methods.setEnableDeposits(l2Token, false).encodeABI();
        assert.equal(setDelayCallToMessengerCall._message, expectedAbiData, "xchain message bytes unexpected");
        assert.equal(setDelayCallToMessengerCall._gasLimit, defaultGasLimit, "xchain gas limit unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgeAdmin.methods
          .setDepositContract(chainId, depositBoxImpersonator, optimismMessenger.options.address)
          .send({ from: owner });
        await bridgeAdmin.methods
          .setEnableDeposits(chainId, l2Token, false, customGasLimit, defaultGasPrice)
          .send({ from: owner });
        assert.equal(
          l1CrossDomainMessengerMock.smocked.sendMessage.calls[0]._gasLimit,
          customGasLimit,
          "xchain gas limit unexpected"
        );
      });
    });
  });
});
