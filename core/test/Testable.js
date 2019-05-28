const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const TestableTest = artifacts.require("TestableTest");

contract("Testable", function() {
  it("isTest on", async function() {
    const testable = await TestableTest.new(true);

    await testable.setCurrentTime(0);
    assert.equal(await testable.getCurrentTime(), 0);
  });

  it("isTest off", async function() {
    const testable = await TestableTest.new(false);

    // Assert that the latest block's timestamp equals the testable contract's current time.
    const { testableTime, blockTime } = await testable.getTestableTimeAndBlockTime();
    assert.equal(testableTime.toString(), blockTime.toString());

    // Assert that setCurrentTime fails
    assert(await didContractThrow(testable.setCurrentTime(0)));
  });
});
