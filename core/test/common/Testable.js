const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const TestableTest = artifacts.require("TestableTest");
const Timer = artifacts.require("Timer");

contract("Testable", function() {
  it("isTest on", async function() {
    const testable = await TestableTest.new(Timer.address);

    await testable.setCurrentTime(0);
    assert.equal(await testable.getCurrentTime(), 0);
  });

  it("isTest off", async function() {
    const testable = await TestableTest.new("0x0000000000000000000000000000000000000000");

    // Assert that the latest block's timestamp equals the testable contract's current time.
    const { testableTime, blockTime } = await testable.getTestableTimeAndBlockTime();
    assert.equal(testableTime.toString(), blockTime.toString());

    // Assert that setCurrentTime fails
    assert(await didContractThrow(testable.setCurrentTime(0)));
  });

  it("In test environment, different Testable contracts reference the same Timer", async function() {
    const testable1 = await TestableTest.new(Timer.address);
    const testable2 = await TestableTest.new(Timer.address);

    // Set time on testable1, should be the same on testable2.
    await testable1.setCurrentTime(0);
    assert.equal(await testable1.getCurrentTime(), 0);
    assert.equal(await testable2.getCurrentTime(), 0);
  });
});
