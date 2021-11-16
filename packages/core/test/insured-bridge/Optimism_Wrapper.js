// These tests are meant to be run within the `hardhat` network (not OVM/AVM). They test the bridge deposit box logic
// and ignore all l2/l1 cross chain admin logic. For those tests see AVM_BridgeDepositBox & OVM_BridgeDepositBox for
// L2 specific unit tests that valid logic pertaining to those chains.

const hre = require("hardhat");
const { getContract, assertEventEmitted } = hre;
const { assert } = require("chai");
const { web3 } = hre;
const { toWei } = web3.utils;
const { didContractThrow } = require("@uma/common");

const Weth9 = getContract("WETH9");
const EthWrapper = getContract("Optimism_Wrapper");

// Contract objects
let wrapper, weth;

const transferAmount = toWei("10");

describe("Optimism_Wrapper", () => {
  let accounts, deployer, bridgePool;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, bridgePool] = accounts;
  });
  beforeEach(async function () {
    weth = await Weth9.new().send({ from: deployer });
    wrapper = await EthWrapper.new(weth.options.address, bridgePool).send({ from: deployer });
  });
  it("wrapAndTransfer", async () => {
    // Send ETH to contract, which will trigger its fallback() method and execute wrapAndTransfer().
    const txn = await web3.eth.sendTransaction({ from: deployer, to: wrapper.options.address, value: transferAmount });
    await assertEventEmitted(txn, weth, "Deposit", (ev) => {
      return ev.dst == wrapper.options.address && ev.wad.toString() == transferAmount;
    });

    // Wrapper contract should have no ETH or WETH balance because it wrapped any received and sent to bridge pool.
    assert.equal((await weth.methods.balanceOf(wrapper.options.address).call()).toString(), "0");
    assert.equal((await web3.eth.getBalance(wrapper.options.address)).toString(), "0");
    assert.equal((await weth.methods.balanceOf(bridgePool).call()).toString(), transferAmount);
  });
  it("changeBridgePool", async () => {
    const changeBridgePool = wrapper.methods.changeBridgePool(deployer);

    // Only owner can call
    assert(await didContractThrow(changeBridgePool.send({ from: bridgePool })));

    const txn = await changeBridgePool.send({ from: deployer });
    await assertEventEmitted(txn, wrapper, "ChangedBridgePool", (ev) => {
      return ev.bridgePool === deployer;
    });
    assert.equal(await wrapper.methods.bridgePool().call(), deployer);
  });
});
