const hre = require("hardhat");
const { didContractThrow, runDefaultFixture, ZERO_ADDRESS } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;

const { assert } = require("chai");

// Tested contract
const BridgeRouter = getContract("OVM_L1BridgeRouter");
const Finder = getContract("Finder");

// Contract objects
let bridgeRouter;
let finder;

describe("OVM_L1BridgeRouter", () => {
  let accounts, owner, rando, l1CrossDomainMessenger;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando, l1CrossDomainMessenger] = accounts;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
  });
  beforeEach(async function () {
    bridgeRouter = await BridgeRouter.new(finder.options.address, l1CrossDomainMessenger, owner, 7200).send({
      from: owner,
    });
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
    it("Add whitelisted Token mapping", async () => {
      const l1Token = rando;
      const l2Token = owner;
      const bridgePoolAddress = l1CrossDomainMessenger;
      assert(
        await didContractThrow(
          bridgeRouter.methods.whitelistToken(l1Token, l2Token, bridgePoolAddress).send({ from: rando })
        ),
        "OnlyOwner modifier not enforced"
      );

      const txn = await bridgeRouter.methods.whitelistToken(l1Token, l2Token, bridgePoolAddress).send({ from: owner });
      await assertEventEmitted(txn, bridgeRouter, "WhitelistToken", (ev) => {
        return ev.l1Token === l1Token && ev.l2Token === l2Token && ev.bridgePool === bridgePoolAddress;
      });

      const tokenMapping = await bridgeRouter.methods.whitelistedTokens(l1Token).call();
      assert.isTrue(
        tokenMapping.l2Token === l2Token && tokenMapping.bridgePool === bridgePoolAddress,
        "Token mapping not created correctly"
      );
    });
  });
});
