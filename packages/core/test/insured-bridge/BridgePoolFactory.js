const hre = require("hardhat");
const { didContractThrow, runDefaultFixture } = require("@uma/common");
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

// Contract objects
let bridgePoolFactory;
let finder;
let l1CrossDomainMessengerMock;
let depositBox;
let identifierWhitelist;
let collateralWhitelist;

// Test function inputs
const defaultGasLimit = 1_000_000;
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 7200;
const defaultProposerBondPct = toWei("0.05");
let l1Token;
let l2Token;
let bridgePoolAddress;

describe("BridgePoolFactory", () => {
  let accounts, owner, rando, l2MessengerImpersonator, depositBoxImpersonator;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando, l2MessengerImpersonator, depositBoxImpersonator] = accounts;
    l1Token = rando;
    l2Token = owner;
    bridgePoolAddress = l2MessengerImpersonator;
    await runDefaultFixture(hre);
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
      defaultIdentifier
    ).send({ from: owner });

    depositBox = await BridgeDepositBox.new(l2MessengerImpersonator, owner).send({ from: owner });
  });
  describe("Admin functions", () => {
    it("Set deposit contract", async () => {
      const newDepositContract = rando;
      assert(
        await didContractThrow(bridgePoolFactory.methods.setDepositContract(newDepositContract).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );

      const txn = await bridgePoolFactory.methods.setDepositContract(newDepositContract).send({ from: owner });
      await assertEventEmitted(txn, bridgePoolFactory, "SetDepositContract", (ev) => {
        return ev.l2DepositContract === newDepositContract;
      });
      assert.equal(await bridgePoolFactory.methods.getDepositContract().call(), newDepositContract);
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
      assert.equal(hexToUtf8(await bridgePoolFactory.methods.getIdentifier().call()), hexToUtf8(newIdentifier));
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
        (await bridgePoolFactory.methods.getOptimisticOracleLiveness().call()).toString(),
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
      assert.equal((await bridgePoolFactory.methods.getProposerBondPct().call()).toString(), newBond.toString());
    });
    describe("Whitelist tokens", () => {
      it("Basic checks", async () => {
        assert(
          await didContractThrow(
            bridgePoolFactory.methods
              .whitelistToken(l1Token, l2Token, bridgePoolAddress, defaultGasLimit)
              .send({ from: rando })
          ),
          "OnlyOwner modifier not enforced"
        );

        // Fails if depositContract not set in BridgeRouter
        assert(
          await didContractThrow(
            bridgePoolFactory.methods
              .whitelistToken(l1Token, l2Token, bridgePoolAddress, defaultGasLimit)
              .send({ from: owner })
          ),
          "Deposit contract not set"
        );
        await bridgePoolFactory.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });

        // Fails if l1 token is not whitelisted
        assert(
          await didContractThrow(
            bridgePoolFactory.methods
              .whitelistToken(l1Token, l2Token, bridgePoolAddress, defaultGasLimit)
              .send({ from: owner })
          ),
          "Deposit contract not set"
        );
        await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });

        // Successful call
        await bridgePoolFactory.methods
          .whitelistToken(l1Token, l2Token, bridgePoolAddress, defaultGasLimit)
          .send({ from: owner });
      });
      it("Add token mapping on L1 and sends xchain message", async () => {
        await bridgePoolFactory.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
        await collateralWhitelist.methods.addToWhitelist(l1Token).send({ from: owner });
        const whitelistTxn = await bridgePoolFactory.methods
          .whitelistToken(l1Token, l2Token, bridgePoolAddress, defaultGasLimit)
          .send({ from: owner });
        assert.isTrue(
          l1CrossDomainMessengerMock.smocked.sendMessage.calls.length === 1,
          "Unexpected number of xdomain messages"
        );
        const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

        // Check for L1 logs and state change
        await assertEventEmitted(whitelistTxn, bridgePoolFactory, "WhitelistToken", (ev) => {
          return ev.l1Token === l1Token && ev.l2Token === l2Token && ev.bridgePool === bridgePoolAddress;
        });
        const tokenMapping = await bridgePoolFactory.methods.getWhitelistedToken(l1Token).call();
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
        const expectedAbiData = depositBox.methods.whitelistToken(l1Token, l2Token).encodeABI();
        assert.equal(whitelistCallToMessengerCall._message, expectedAbiData, "xchain message bytes unexpected");
        assert.equal(whitelistCallToMessengerCall._gasLimit, defaultGasLimit, "xchain gas limit unexpected");
      });
      it("Works with custom gas", async () => {
        const customGasLimit = 10;
        await bridgePoolFactory.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
        await bridgePoolFactory.methods
          .whitelistToken(l1Token, l2Token, bridgePoolAddress, customGasLimit)
          .send({ from: owner });
        const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];
        assert.equal(whitelistCallToMessengerCall._gasLimit, customGasLimit, "xchain gas limit unexpected");
      });
    });
  });
});
