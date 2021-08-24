const hre = require("hardhat");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const TestableTest = getContract("TestableTest");
const Timer = getContract("Timer");

describe("Testable", function () {
  let accounts;
  let timer;

  before(async () => {
    accounts = await web3.eth.getAccounts();
    timer = await Timer.new().send({ from: accounts[0] });
  });

  it("isTest on", async function () {
    const testable = await TestableTest.new(timer.options.address).send({ from: accounts[0] });

    await testable.methods.setCurrentTime(0).send({ from: accounts[0] });
    assert.equal(await testable.methods.getCurrentTime().call(), 0);
  });

  it("isTest off", async function () {
    const testable = await TestableTest.new("0x0000000000000000000000000000000000000000").send({ from: accounts[0] });

    // Assert that the latest block's timestamp equals the testable contract's current time.
    const { testableTime, blockTime } = await testable.methods.getTestableTimeAndBlockTime().call();
    assert.equal(testableTime.toString(), blockTime.toString());

    // Assert that setCurrentTime fails
    assert(await didContractThrow(testable.methods.setCurrentTime(0).send({ from: accounts[0] })));
  });

  it("In test environment, different Testable contracts reference the same Timer", async function () {
    const testable1 = await TestableTest.new(timer.options.address).send({ from: accounts[0] });
    const testable2 = await TestableTest.new(timer.options.address).send({ from: accounts[0] });

    // Set time on testable1, should be the same on testable2.
    await testable1.methods.setCurrentTime(0).send({ from: accounts[0] });
    assert.equal(await testable1.methods.getCurrentTime().call(), 0);
    assert.equal(await testable2.methods.getCurrentTime().call(), 0);
  });
});
