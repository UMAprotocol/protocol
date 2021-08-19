const hre = require("hardhat");
const { didContractThrow, runDefaultFixture, ZERO_ADDRESS } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { hexToUtf8, utf8ToHex, toWei } = web3.utils;

const { deployOptimismContractMock } = require("./helpers/SmockitHelper");

const { assert } = require("chai");

// Tested contracts
const BridgeAdmin = getContract("BridgeAdmin");
const BridgePool = getContract("BridgePool");
const Timer = getContract("Timer");
const Finder = getContract("Finder");
const BridgeDepositBox = getContract("OVM_BridgeDepositBox");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");

// Contract objects
let bridgeAdmin;
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
const lpFeeRatePerSecond = toWei("0.0000015");
const defaultBridgingDelay = 60;
let l1Token;
let l2Token;
let bridgePool;

describe("BridgeAdmin", () => {
  let accounts, owner, rando, depositBoxImpersonator;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando, depositBoxImpersonator] = accounts;
    l1Token = rando;
    l2Token = owner;
    await runDefaultFixture(hre);
    timer = await Timer.deployed();
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: owner });
  });
  beforeEach(async function () {
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");

    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
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
  describe("Admin functions", () => {
    it("Set deposit contract", async () => {
      const newDepositContract = rando;
      assert(
        await didContractThrow(bridgeAdmin.methods.setDepositContract(newDepositContract).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );
      assert(
        await didContractThrow(bridgeAdmin.methods.setDepositContract(ZERO_ADDRESS).send({ from: owner })),
        "Can't set to 0x address"
      );
      const txn = await bridgeAdmin.methods.setDepositContract(newDepositContract).send({ from: owner });
      await assertEventEmitted(txn, bridgeAdmin, "SetDepositContract", (ev) => {
        return ev.l2DepositContract === newDepositContract;
      });
      assert.equal(await bridgeAdmin.methods.depositContract().call(), newDepositContract);
    });
    it("Set relay identifier", async () => {
      const newIdentifier = utf8ToHex("NEW_IDENTIFIER");
      assert(
        await didContractThrow(bridgeAdmin.methods.setIdentifier(newIdentifier).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );
      assert(
        await didContractThrow(bridgeAdmin.methods.setIdentifier(newIdentifier).send({ from: owner })),
        "Identifier must be whitelisted"
      );
      await identifierWhitelist.methods.addSupportedIdentifier(newIdentifier).send({ from: owner });
      const txn = await bridgeAdmin.methods.setIdentifier(newIdentifier).send({ from: owner });
      await assertEventEmitted(txn, bridgeAdmin, "SetRelayIdentifier", (ev) => {
        return hexToUtf8(ev.identifier) === hexToUtf8(newIdentifier);
      });
      assert.equal(hexToUtf8(await bridgeAdmin.methods.identifier().call()), hexToUtf8(newIdentifier));
    });
    it("Set optimistic oracle liveness", async () => {
      const newLiveness = 100;
      assert(
        await didContractThrow(bridgeAdmin.methods.setOptimisticOracleLiveness(newLiveness).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );

      // Liveness too large.
      assert(await didContractThrow(bridgeAdmin.methods.setOptimisticOracleLiveness(toWei("1")).send({ from: owner })));

      // Liveness too small.
      assert(await didContractThrow(bridgeAdmin.methods.setOptimisticOracleLiveness("0").send({ from: owner })));

      const txn = await bridgeAdmin.methods.setOptimisticOracleLiveness(newLiveness).send({ from: owner });
      await assertEventEmitted(txn, bridgeAdmin, "SetOptimisticOracleLiveness", (ev) => {
        return ev.liveness.toString() === newLiveness.toString();
      });
      assert.equal((await bridgeAdmin.methods.optimisticOracleLiveness().call()).toString(), newLiveness.toString());
    });
    it("Set proposer bond", async () => {
      const newBond = toWei("0.1");
      assert(
        await didContractThrow(bridgeAdmin.methods.setProposerBondPct(newBond).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );

      const txn = await bridgeAdmin.methods.setProposerBondPct(newBond).send({ from: owner });
      await assertEventEmitted(txn, bridgeAdmin, "SetProposerBondPct", (ev) => {
        return ev.proposerBondPct.toString() === newBond.toString();
      });
      assert.equal((await bridgeAdmin.methods.proposerBondPct().call()).toString(), newBond.toString());
    });
    describe("CrossDomain Admin functions", () => {
      describe("Whitelist tokens", () => {
        it("Basic checks", async () => {
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(l1Token, l2Token, bridgePool.options.address, defaultGasLimit)
                .send({ from: rando })
            ),
            "OnlyOwner modifier not enforced"
          );

          // Fails if depositContract not set in BridgeRouter
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(l1Token, l2Token, bridgePool.options.address, defaultGasLimit)
                .send({ from: owner })
            ),
            "Deposit contract not set"
          );
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });

          // Fails if l1 token is not whitelisted
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(l1Token, l2Token, bridgePool.options.address, defaultGasLimit)
                .send({ from: owner })
            ),
            "L1 token is not whitelisted collateral"
          );
          await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });

          // Fails if l2 token address is invalid
          assert(
            await didContractThrow(
              bridgeAdmin.methods
                .whitelistToken(l1Token, ZERO_ADDRESS, bridgePool.options.address, defaultGasLimit)
                .send({ from: owner })
            ),
            "L2 token cannot be zero address"
          );

          // Fails if bridge pool is zero address.
          assert(
            await didContractThrow(
              bridgeAdmin.methods.whitelistToken(l1Token, l2Token, ZERO_ADDRESS, defaultGasLimit).send({ from: owner })
            ),
            "BridgePool cannot be zero address"
          );

          // Successful call
          await bridgeAdmin.methods
            .whitelistToken(l1Token, l2Token, bridgePool.options.address, defaultGasLimit)
            .send({ from: owner });
        });
        it("Add token mapping on L1 and sends xchain message", async () => {
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
          await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });
          const whitelistTxn = await bridgeAdmin.methods
            .whitelistToken(l1Token, l2Token, bridgePool.options.address, defaultGasLimit)
            .send({ from: owner });
          const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

          // Check for L1 logs and state change
          await assertEventEmitted(whitelistTxn, bridgeAdmin, "WhitelistToken", (ev) => {
            return ev.l1Token === l1Token && ev.l2Token === l2Token && ev.bridgePool === bridgePool.options.address;
          });
          const tokenMapping = await bridgeAdmin.methods.whitelistedTokens(l1Token).call();
          assert.isTrue(
            tokenMapping.l2Token === l2Token && tokenMapping.bridgePool === bridgePool.options.address,
            "Token mapping not created correctly"
          );

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
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
          await bridgeAdmin.methods
            .whitelistToken(l1Token, l2Token, bridgePool.options.address, customGasLimit)
            .send({ from: owner });
          const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];
          assert.equal(whitelistCallToMessengerCall._gasLimit, customGasLimit, "xchain gas limit unexpected");
        });
      });
      describe("Set bridge admin", () => {
        it("Basic checks", async () => {
          assert(
            await didContractThrow(bridgeAdmin.methods.setBridgeAdmin(rando, defaultGasLimit).send({ from: rando })),
            "OnlyOwner modifier not enforced"
          );

          // Fails if depositContract not set in BridgeRouter
          assert(
            await didContractThrow(bridgeAdmin.methods.setBridgeAdmin(rando, defaultGasLimit).send({ from: owner })),
            "Deposit contract not set"
          );
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });

          // Admin cannot be 0x0
          assert(
            await didContractThrow(
              bridgeAdmin.methods.setBridgeAdmin(ZERO_ADDRESS, defaultGasLimit).send({ from: owner })
            ),
            "Cannot set to 0 address"
          );

          // Successful call
          await bridgeAdmin.methods.setBridgeAdmin(rando, defaultGasLimit).send({ from: owner });
        });
        it("Changes admin address", async () => {
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
          const setAdminTxn = await bridgeAdmin.methods.setBridgeAdmin(rando, defaultGasLimit).send({ from: owner });
          const setAdminCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

          // Check for L1 logs and state change
          await assertEventEmitted(setAdminTxn, bridgeAdmin, "SetBridgeAdmin", (ev) => {
            return ev.bridgeAdmin === rando;
          });

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
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
          await bridgeAdmin.methods.setBridgeAdmin(rando, customGasLimit).send({ from: owner });
          assert.equal(
            l1CrossDomainMessengerMock.smocked.sendMessage.calls[0]._gasLimit,
            customGasLimit,
            "xchain gas limit unexpected"
          );
        });
      });
      describe("Set minimum bridge delay", () => {
        it("Basic checks", async () => {
          assert(
            await didContractThrow(
              bridgeAdmin.methods.setMinimumBridgingDelay(defaultBridgingDelay, defaultGasLimit).send({ from: rando })
            ),
            "OnlyOwner modifier not enforced"
          );

          // Fails if depositContract not set in BridgeRouter
          assert(
            await didContractThrow(
              bridgeAdmin.methods.setMinimumBridgingDelay(defaultBridgingDelay, defaultGasLimit).send({ from: owner })
            ),
            "Deposit contract not set"
          );
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });

          // Successful call
          await bridgeAdmin.methods
            .setMinimumBridgingDelay(defaultBridgingDelay, defaultGasLimit)
            .send({ from: owner });
        });
        it("Sets delay", async () => {
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
          const setDelayTxn = await bridgeAdmin.methods
            .setMinimumBridgingDelay(defaultBridgingDelay, defaultGasLimit)
            .send({ from: owner });
          const setDelayCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

          // Check for L1 logs and state change
          await assertEventEmitted(setDelayTxn, bridgeAdmin, "SetMinimumBridgingDelay", (ev) => {
            return ev.newMinimumBridgingDelay.toString() === defaultBridgingDelay.toString();
          });

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
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
          await bridgeAdmin.methods.setMinimumBridgingDelay(defaultBridgingDelay, customGasLimit).send({ from: owner });
          assert.equal(
            l1CrossDomainMessengerMock.smocked.sendMessage.calls[0]._gasLimit,
            customGasLimit,
            "xchain gas limit unexpected"
          );
        });
      });
      describe("Pause deposits", () => {
        it("Basic checks", async () => {
          assert(
            await didContractThrow(
              bridgeAdmin.methods.setEnableDeposits(l2Token, false, defaultGasLimit).send({ from: rando })
            ),
            "OnlyOwner modifier not enforced"
          );

          // Fails if depositContract not set in BridgeRouter
          assert(
            await didContractThrow(
              bridgeAdmin.methods.setEnableDeposits(l2Token, false, defaultGasLimit).send({ from: owner })
            ),
            "Deposit contract not set"
          );
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });

          // Successful call
          await bridgeAdmin.methods.setEnableDeposits(l2Token, false, defaultGasLimit).send({ from: owner });
        });
        it("Sets boolean value", async () => {
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
          const setDelayTxn = await bridgeAdmin.methods
            .setEnableDeposits(l2Token, false, defaultGasLimit)
            .send({ from: owner });
          const setDelayCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

          // Check for L1 logs and state change
          await assertEventEmitted(setDelayTxn, bridgeAdmin, "DepositsEnabled", (ev) => {
            return Boolean(ev.depositsEnabled) === false && ev.l2Token === l2Token;
          });

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
          await bridgeAdmin.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
          await bridgeAdmin.methods.setEnableDeposits(l2Token, false, customGasLimit).send({ from: owner });
          assert.equal(
            l1CrossDomainMessengerMock.smocked.sendMessage.calls[0]._gasLimit,
            customGasLimit,
            "xchain gas limit unexpected"
          );
        });
      });
    });
  });
});
