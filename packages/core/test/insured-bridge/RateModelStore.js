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
    console.log(await store.methods.l1TokenRateModels(l1Token).call());
    assert.equal(
      await store.methods.l1TokenRateModels(l1Token).call(),
      "" // Empty string
    );

    const newRateModel = JSON.stringify({ key: "value" });

    const updateRateModel = store.methods.updateRateModel(l1Token, newRateModel);

    // Only owner can update.
    assert(await didContractThrow(updateRateModel.send({ from: user })));

    const txn = await updateRateModel.send({ from: owner });
    assert.equal(await store.methods.l1TokenRateModels(l1Token).call(), newRateModel);
    assertEventEmitted(txn, store, "UpdatedRateModel", (ev) => {
      return ev.rateModel === newRateModel && ev.l1Token === l1Token;
    });
  });
});
