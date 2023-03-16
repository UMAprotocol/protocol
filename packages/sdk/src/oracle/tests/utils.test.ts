import assert from "assert";
import * as utils from "../utils";

describe("Oracle Utils", function () {
  test("rangeDescending", function () {
    const startBlock = 0;
    const endBlock = 14083360;
    const range = endBlock - startBlock;
    let expectedRange = range;

    let rangeState = utils.rangeStart({ startBlock, endBlock });

    assert.equal(rangeState.currentStart, startBlock);
    assert.equal(rangeState.currentEnd, endBlock);
    assert.equal(rangeState.currentRange, expectedRange);
    assert.ok(!rangeState.done);

    // halve range
    expectedRange = Math.floor(expectedRange / (rangeState.multiplier || 2));
    rangeState = utils.rangeFailureDescending(rangeState);
    assert.equal(rangeState.currentRange, expectedRange);
    assert.equal(rangeState.currentEnd, endBlock);
    assert.equal(rangeState.currentStart, endBlock - expectedRange);
    assert.ok(!rangeState.done);

    expectedRange = Math.floor(expectedRange / (rangeState.multiplier || 2));
    rangeState = utils.rangeFailureDescending(rangeState);
    assert.equal(rangeState.currentRange, expectedRange);
    assert.equal(rangeState.currentEnd, endBlock);
    assert.equal(rangeState.currentStart, endBlock - expectedRange);
    assert.ok(!rangeState.done);

    expectedRange = Math.floor(expectedRange / (rangeState.multiplier || 2));
    rangeState = utils.rangeFailureDescending(rangeState);
    assert.equal(rangeState.currentRange, expectedRange);
    assert.equal(rangeState.currentEnd, endBlock);
    assert.equal(rangeState.currentStart, endBlock - expectedRange);
    assert.ok(!rangeState.done);

    expectedRange = Math.floor(expectedRange * (rangeState.multiplier || 2));
    rangeState = utils.rangeSuccessDescending(rangeState);
    assert.equal(rangeState.currentRange, expectedRange);
    assert.equal(rangeState.currentEnd, endBlock - Math.floor(expectedRange / 2));
    assert.equal(rangeState.currentStart, endBlock - (Math.floor(expectedRange / 2) + expectedRange));
    assert.ok(!rangeState.done);

    expectedRange = Math.floor(expectedRange * (rangeState.multiplier || 2));
    rangeState = utils.rangeSuccessDescending(rangeState);
    assert.equal(rangeState.currentRange, expectedRange);

    expectedRange = Math.floor(expectedRange * (rangeState.multiplier || 2));
    rangeState = utils.rangeSuccessDescending(rangeState);
    assert.equal(rangeState.currentRange, expectedRange);
    assert.equal(rangeState.currentStart, startBlock);
    assert.ok(!rangeState.done);

    rangeState = utils.rangeSuccessDescending(rangeState);
    assert.ok(rangeState.done);
  });
  test("rangeDescending.maxRange", function () {
    const startBlock = 0;
    const endBlock = 14083360;
    const maxRange = 100;

    let rangeState = utils.rangeStart({ startBlock, endBlock, maxRange });

    assert.equal(rangeState.currentStart, endBlock - maxRange);
    assert.equal(rangeState.currentEnd, endBlock);
    assert.equal(rangeState.currentRange, maxRange);
    assert.ok(!rangeState.done);

    rangeState = utils.rangeSuccessDescending(rangeState);
    assert.equal(rangeState.currentStart, endBlock - maxRange * 2);
    assert.equal(rangeState.currentEnd, endBlock - maxRange);
    assert.ok(!rangeState.done);
  });
});
