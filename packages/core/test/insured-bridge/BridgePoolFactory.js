const hre = require("hardhat");
const { didContractThrow, runDefaultFixture, ZERO_ADDRESS } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { hexToUtf8, utf8ToHex, toWei } = web3.utils;

const { deployOptimismContractMock } = require("./helpers/SmockitHelper");

const { assert } = require("chai");

// Tested contracts
const BridgePoolFactory = getContract("BridgePoolFactory");
const Finder = getContract("Finder");
const BridgeDepositBox = getContract("OVM_BridgeDepositBox");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const Timer = getContract("Timer");

// Contract objects
let bridgePoolFactory;
let finder;
let l1CrossDomainMessengerMock;
let depositBox;
let identifierWhitelist;
let collateralWhitelist;
let timer;

// Test function inputs
const defaultGasLimit = 1_000_000;
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 7200;
const defaultProposerBondPct = toWei("0.05");
const defaultBridgingDelay = 60;
let l1Token;
let l2Token;

describe("BridgePoolFactory", () => {
  let accounts, owner, rando, depositBoxImpersonator, bridgePoolFactoryImpersonator;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando, depositBoxImpersonator, bridgePoolFactoryImpersonator] = accounts;
    l1Token = rando;
    l2Token = owner;
    await runDefaultFixture(hre);
    timer = await Timer.new().send({ from: owner });
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: owner });
  });
  beforeEach(async function () {
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");

    bridgePoolFactory = await BridgePoolFactory.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier,
      timer.options.address
    ).send({ from: owner });

    depositBox = await BridgeDepositBox.new(bridgePoolFactoryImpersonator, defaultBridgingDelay, ZERO_ADDRESS).send({
      from: owner,
    });
  });
  describe("Admin functions", () => {
    it("Set deposit contract", async () => {
      const newDepositContract = rando;
      assert(
        await didContractThrow(bridgePoolFactory.methods.setDepositContract(newDepositContract).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );
      assert(
        await didContractThrow(bridgePoolFactory.methods.setDepositContract(ZERO_ADDRESS).send({ from: owner })),
        "Can't set to 0x address"
      );
      const txn = await bridgePoolFactory.methods.setDepositContract(newDepositContract).send({ from: owner });
      await assertEventEmitted(txn, bridgePoolFactory, "SetDepositContract", (ev) => {
        return ev.l2DepositContract === newDepositContract;
      });
      assert.equal(await bridgePoolFactory.methods.depositContract().call(), newDepositContract);
    });
    it("Set relay identifier", async () => {
      const newIdentifier = utf8ToHex("NEW_IDENTIFIER");
      assert(
        await didContractThrow(bridgePoolFactory.methods.setIdentifier(newIdentifier).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );
      assert(
        await didContractThrow(bridgePoolFactory.methods.setIdentifier(newIdentifier).send({ from: owner })),
        "Identifier must be whitelisted"
      );
      await identifierWhitelist.methods.addSupportedIdentifier(newIdentifier).send({ from: owner });
      const txn = await bridgePoolFactory.methods.setIdentifier(newIdentifier).send({ from: owner });
      await assertEventEmitted(txn, bridgePoolFactory, "SetRelayIdentifier", (ev) => {
        return hexToUtf8(ev.identifier) === hexToUtf8(newIdentifier);
      });
      assert.equal(hexToUtf8(await bridgePoolFactory.methods.identifier().call()), hexToUtf8(newIdentifier));
    });
    it("Set optimistic oracle liveness", async () => {
      const newLiveness = 100;
      assert(
        await didContractThrow(
          bridgePoolFactory.methods.setOptimisticOracleLiveness(newLiveness).send({ from: rando })
        ),
        "OnlyOwner modifier not enforced"
      );

      const txn = await bridgePoolFactory.methods.setOptimisticOracleLiveness(newLiveness).send({ from: owner });
      await assertEventEmitted(txn, bridgePoolFactory, "SetOptimisticOracleLiveness", (ev) => {
        return ev.liveness.toString() === newLiveness.toString();
      });
      assert.equal(
        (await bridgePoolFactory.methods.optimisticOracleLiveness().call()).toString(),
        newLiveness.toString()
      );
    });
    it("Set proposer bond", async () => {
      const newBond = toWei("0.1");
      assert(
        await didContractThrow(bridgePoolFactory.methods.setProposerBondPct(newBond).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );

      const txn = await bridgePoolFactory.methods.setProposerBondPct(newBond).send({ from: owner });
      await assertEventEmitted(txn, bridgePoolFactory, "SetProposerBondPct", (ev) => {
        return ev.proposerBondPct.toString() === newBond.toString();
      });
      assert.equal((await bridgePoolFactory.methods.proposerBondPct().call()).toString(), newBond.toString());
    });
    describe("Whitelist tokens", () => {
      it("Basic checks", async () => {
        assert(
          await didContractThrow(
            bridgePoolFactory.methods.whitelistToken(l1Token, l2Token, defaultGasLimit).send({ from: rando })
          ),
          "OnlyOwner modifier not enforced"
        );

        // Fails if depositContract not set in BridgeRouter
        assert(
          await didContractThrow(
            bridgePoolFactory.methods.whitelistToken(l1Token, l2Token, defaultGasLimit).send({ from: owner })
          ),
          "Deposit contract not set"
        );
        await bridgePoolFactory.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });

        // Fails if l1 token is not whitelisted
        assert(
          await didContractThrow(
            bridgePoolFactory.methods.whitelistToken(l1Token, l2Token, defaultGasLimit).send({ from: owner })
          ),
          "Deposit contract not set"
        );
        await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });

        // Successful call
        await bridgePoolFactory.methods.whitelistToken(l1Token, l2Token, defaultGasLimit).send({ from: owner });
      });
      it("Add token mapping on L1, deploys a new BridgePool, and sends xchain message", async () => {
        await bridgePoolFactory.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
        await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });
        const whitelistTxn = await bridgePoolFactory.methods
          .whitelistToken(l1Token, l2Token, defaultGasLimit)
          .send({ from: owner });
        const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

        // Grab new bridge pool address from event.
        const deploymentEvents = await bridgePoolFactory.getPastEvents("DeployedBridgePool", {
          fromBlock: whitelistTxn.blockNumber,
          toBlock: whitelistTxn.blockNumber,
        });
        const bridgePoolAddress = deploymentEvents[0].returnValues.bridgePool;

        // Validate that BridgePool stores BridgePoolFactory address correctly.
        const bridgePool = new web3.eth.Contract(getContract("BridgePool").abi, bridgePoolAddress);
        assert.equal(
          await bridgePool.methods.bridgePoolFactory().call({ from: owner }),
          bridgePoolFactory.options.address
        );

        // Check for L1 logs and state change
        await assertEventEmitted(whitelistTxn, bridgePoolFactory, "WhitelistToken", (ev) => {
          return ev.l1Token === l1Token && ev.l2Token === l2Token && ev.bridgePool === bridgePoolAddress;
        });
        const tokenMapping = await bridgePoolFactory.methods.whitelistedTokens(l1Token).call();
        assert.isTrue(
          tokenMapping.l2Token === l2Token && tokenMapping.bridgePool === bridgePoolAddress,
          "Token mapping not created correctly"
        );

        // Validate xchain message
        assert.equal(
          whitelistCallToMessengerCall._target,
          depositBoxImpersonator,
          "xchain target should be deposit contract"
        );
        const expectedAbiData = depositBox.methods.whitelistToken(l1Token, l2Token, bridgePoolAddress).encodeABI();
        assert.equal(whitelistCallToMessengerCall._message, expectedAbiData, "xchain message bytes unexpected");
        assert.equal(whitelistCallToMessengerCall._gasLimit, defaultGasLimit, "xchain gas limit unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgePoolFactory.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
        await bridgePoolFactory.methods.whitelistToken(l1Token, l2Token, customGasLimit).send({ from: owner });
        const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];
        assert.equal(whitelistCallToMessengerCall._gasLimit, customGasLimit, "xchain gas limit unexpected");
      });
      it("Duplicate call does not deploy a new BridgePool", async function () {
        await bridgePoolFactory.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
        const deploymentTxn = await bridgePoolFactory.methods
          .whitelistToken(l1Token, l2Token, defaultGasLimit)
          .send({ from: owner });

        // Grab new bridge pool address from event.
        const deploymentEvents = await bridgePoolFactory.getPastEvents("DeployedBridgePool", {
          fromBlock: deploymentTxn.blockNumber,
          toBlock: deploymentTxn.blockNumber,
        });
        const bridgePoolAddress = deploymentEvents[0].returnValues.bridgePool;

        // This should not deploy a second BridgePool
        const newL2Token = rando;
        const repeatDeploymentTxn = await bridgePoolFactory.methods
          .whitelistToken(l1Token, newL2Token, defaultGasLimit)
          .send({ from: owner });
        const repeatDeploymentEvents = await bridgePoolFactory.getPastEvents("DeployedBridgePool", {
          fromBlock: repeatDeploymentTxn.blockNumber,
          toBlock: repeatDeploymentTxn.blockNumber,
        });
        assert.equal(repeatDeploymentEvents.length, 0);

        // This should still emit a cross-chain admin transaction.
        const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];
        assert.equal(
          whitelistCallToMessengerCall._target,
          depositBoxImpersonator,
          "xchain target should be deposit contract"
        );
        const expectedAbiData = depositBox.methods.whitelistToken(l1Token, newL2Token, bridgePoolAddress).encodeABI();
        assert.equal(whitelistCallToMessengerCall._message, expectedAbiData, "xchain message bytes unexpected");
        assert.equal(whitelistCallToMessengerCall._gasLimit, defaultGasLimit, "xchain gas limit unexpected");
      });
    });
    describe("Set bridge admin", () => {
      it("Changes admin address", async () => {
        await bridgePoolFactory.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
        const setAdminTxn = await bridgePoolFactory.methods.setBridgeAdmin(defaultGasLimit).send({ from: owner });

        assert.isTrue(
          l1CrossDomainMessengerMock.smocked.sendMessage.calls.length === 1,
          "Unexpected number of xdomain messages"
        );
        const setAdminCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

        // Check for L1 logs and state change
        await assertEventEmitted(setAdminTxn, bridgePoolFactory, "SetBridgeAdmin", (ev) => {
          return ev.bridgeAdmin === bridgePoolFactory.options.address;
        });

        // Validate xchain message
        assert.equal(
          setAdminCallToMessengerCall._target,
          depositBoxImpersonator,
          "xchain target should be deposit contract"
        );
        const expectedAbiData = depositBox.methods.setBridgeAdmin(bridgePoolFactory.options.address).encodeABI();
        assert.equal(setAdminCallToMessengerCall._message, expectedAbiData, "xchain message bytes unexpected");
        assert.equal(setAdminCallToMessengerCall._gasLimit, defaultGasLimit, "xchain gas limit unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgePoolFactory.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
        await bridgePoolFactory.methods.setBridgeAdmin(customGasLimit).send({ from: owner });
        assert.equal(
          l1CrossDomainMessengerMock.smocked.sendMessage.calls[0]._gasLimit,
          customGasLimit,
          "xchain gas limit unexpected"
        );
      });
    });
  });
});
