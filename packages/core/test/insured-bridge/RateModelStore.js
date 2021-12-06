const hre = require("hardhat");
const { getContract, assertEventEmitted } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const RateModelStore = getContract("RateModelStore");

describe("RateModelStore", function () {
  let accounts;
  let owner;
  let user;

  let store;
  let l1Token;
  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, user, l1Token] = accounts;

    store = await RateModelStore.new().send({ from: owner });
  });

  it("Update rate model for L1 token", async function () {
    assert.equal(
      await store.methods.getRateModel(l1Token).call(),
      "" // Empty string
    );

    const rateModel = JSON.stringify({ key: "value" });
    const startBlock = 0; // Set start block so that rate model updates immediately.

    const updateRateModel = store.methods.updateRateModel(l1Token, rateModel, startBlock);

    // Only owner can update.
    assert(await didContractThrow(updateRateModel.send({ from: user })));

    const txn = await updateRateModel.send({ from: owner });
    assert.equal(await store.methods.getRateModel(l1Token).call(), rateModel);
    assertEventEmitted(txn, store, "UpdatedRateModel", (ev) => {
      return (
        ev.newRateModel === rateModel &&
        ev.l1Token === l1Token &&
        ev.oldRateModel === "" &&
        ev.startBlock.toString() === startBlock.toString()
      );
    });

    // Now call update rate model again with a new rate model but a start block very far into the future so that the
    // new rate model does not update yet.
    const rateModel2 = JSON.stringify({ key: "newValue" });
    const startBlock2 = 999999;
    const txn2 = await store.methods.updateRateModel(l1Token, rateModel2, startBlock2).send({ from: owner });
    assert.equal(await store.methods.getRateModel(l1Token).call(), rateModel); // Latest rate model doesn't change.
    assertEventEmitted(txn2, store, "UpdatedRateModel", (ev) => {
      return (
        ev.newRateModel === rateModel2 &&
        ev.l1Token === l1Token &&
        ev.oldRateModel === rateModel && // Old rate model is the recently updated rate model
        ev.startBlock.toString() === startBlock2.toString()
      );
    });

    // Finally, call rate model again with a start block set lower than the recently updated start block. Check that the
    // "old" rate model remains the same.
    const rateModel3 = JSON.stringify({ key: "evenNewerValue" });
    const startBlock3 = startBlock; // This means that this rate model should immediately take effect, effectively
    // erasing rateModel2.
    const txn3 = await store.methods.updateRateModel(l1Token, rateModel3, startBlock3).send({ from: owner });
    assert.equal(await store.methods.getRateModel(l1Token).call(), rateModel3);
    assertEventEmitted(txn3, store, "UpdatedRateModel", (ev) => {
      return (
        ev.newRateModel === rateModel3 &&
        ev.l1Token === l1Token &&
        ev.oldRateModel === rateModel && // Old rate model remains the same after the last update because the rateModel2
        // hasn't updated yet.
        ev.startBlock.toString() === startBlock3.toString()
      );
    });
  });
});
