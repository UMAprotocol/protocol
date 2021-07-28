const hre = require("hardhat");
const { didContractThrow, runDefaultFixture, ZERO_ADDRESS } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;

const { deployOptimismContractMock } = require("./helpers/SmockitHelper");

const { assert } = require("chai");

// Tested contracts
const BridgeRouter = getContract("BridgeRouter");
const Finder = getContract("Finder");
const BridgeDepositBox = getContract("OVM_BridgeDepositBox");

// Contract objects
let bridgeRouter;
let finder;
let l1CrossDomainMessengerMock;
let depositBox;

// Test function inputs
const defaultGasLimit = 1_000_000;
let l1Token;
let l2Token;
let bridgePoolAddress;

describe("BridgeRouter", () => {
  let accounts, owner, rando, l2MessengerImpersonator, depositBoxImpersonator;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando, l2MessengerImpersonator, depositBoxImpersonator] = accounts;
    l1Token = rando;
    l2Token = owner;
    bridgePoolAddress = l2MessengerImpersonator;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
  });
  beforeEach(async function () {
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");

    bridgeRouter = await BridgeRouter.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
      owner,
      7200
    ).send({ from: owner });

    depositBox = await BridgeDepositBox.new(l2MessengerImpersonator, owner).send({ from: owner });
  });
  describe("Admin functions", () => {
    it("Ownership", async () => {
      assert.equal(await bridgeRouter.methods.owner().call(), owner, "Owner not set on construction");

      assert(
        await didContractThrow(bridgeRouter.methods.transferOwnership(rando).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );

      await bridgeRouter.methods.transferOwnership(rando).send({ from: owner });
      assert.equal(await bridgeRouter.methods.owner().call(), rando, "Ownership not transferred");

      await bridgeRouter.methods.renounceOwnership().send({ from: rando });
      assert.equal(await bridgeRouter.methods.owner().call(), ZERO_ADDRESS, "Ownership not renounced");
    });
    it("Set Deposit contract", async () => {
      const newDepositContract = rando;
      assert(
        await didContractThrow(bridgeRouter.methods.setDepositContract(newDepositContract).send({ from: rando })),
        "OnlyOwner modifier not enforced"
      );

      const txn = await bridgeRouter.methods.setDepositContract(newDepositContract).send({ from: owner });
      await assertEventEmitted(txn, bridgeRouter, "SetDepositContract", (ev) => {
        return ev.l2DepositContract === newDepositContract;
      });
    });
    describe("Whitelist tokens", () => {
      it("Basic checks", async () => {
        assert(
          await didContractThrow(
            bridgeRouter.methods
              .whitelistToken(l1Token, l2Token, bridgePoolAddress, defaultGasLimit)
              .send({ from: rando })
          ),
          "OnlyOwner modifier not enforced"
        );

        // Fails if depositContract not set in BridgeRouter
        assert(
          await didContractThrow(
            bridgeRouter.methods
              .whitelistToken(l1Token, l2Token, bridgePoolAddress, defaultGasLimit)
              .send({ from: owner })
          ),
          "Deposit contract not set"
        );
        await bridgeRouter.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });

        // Successful call
        await bridgeRouter.methods
          .whitelistToken(l1Token, l2Token, bridgePoolAddress, defaultGasLimit)
          .send({ from: owner });
      });
      it("Add token mapping on L1 and sends xchain message", async () => {
        await bridgeRouter.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
        const whitelistTxn = await bridgeRouter.methods
          .whitelistToken(l1Token, l2Token, bridgePoolAddress, defaultGasLimit)
          .send({ from: owner });
        const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

        // Check for L1 logs and state change
        await assertEventEmitted(whitelistTxn, bridgeRouter, "WhitelistToken", (ev) => {
          return ev.l1Token === l1Token && ev.l2Token === l2Token && ev.bridgePool === bridgePoolAddress;
        });
        const tokenMapping = await bridgeRouter.methods.whitelistedTokens(l1Token).call();
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
        await bridgeRouter.methods.setDepositContract(depositBoxImpersonator).send({ from: owner });
        await bridgeRouter.methods
          .whitelistToken(l1Token, l2Token, bridgePoolAddress, customGasLimit)
          .send({ from: owner });
        const whitelistCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];
        assert.equal(whitelistCallToMessengerCall._gasLimit, customGasLimit, "xchain gas limit unexpected");
      });
    });
  });
});
