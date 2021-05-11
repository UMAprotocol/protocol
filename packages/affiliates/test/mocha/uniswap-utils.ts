import { assert } from "chai";
import * as Utils from "../../libs/uniswap/utils";

describe("utils", function() {
  it("exists", function() {
    let result = Utils.exists(undefined);
    assert.equal(result, false);
    result = Utils.exists(null);
    assert.equal(result, false);
    result = Utils.exists(0);
    assert.equal(result, true);
    result = Utils.exists({});
    assert.equal(result, true);
    result = Utils.exists("0");
    assert.equal(result, true);
  });
  it("getPositionKey", function() {
    const actualPosition = {
      id: "0x6c01d5d018ed39585c5eb8b0fd8cf78eb58348096a1a7310cde373d20de844f6",
      operator: "0xb6b312AE470126D09e2E47a395c2b783dd82366d",
      sender: "0xb6b312AE470126D09e2E47a395c2b783dd82366d",
      tickLower: "-25740",
      tickUpper: "-24660",
      blockCreated: "8515148",
      pool: "0x4E3f5778bafE258e4E75786f38fa3f8bE34Ad7f2"
    };
    const result = Utils.getPositionKey(actualPosition.operator, actualPosition.tickLower, actualPosition.tickUpper);
    assert.equal(result, actualPosition.id);
  });
  it("liquidityPerTick", function() {
    let result = Utils.liquidityPerTick({
      liquidity: "1000",
      tickLower: "0",
      tickUpper: "10"
    });
    assert.equal(result, "100");
    result = Utils.liquidityPerTick({
      liquidity: "1000",
      tickLower: "0",
      tickUpper: "1"
    });
    assert.equal(result, "1000");
    assert.throws(() => Utils.liquidityPerTick({ liquidity: "1000", tickLower: "1", tickUpper: "1" }));
  });
  it("IsPositionActive", function() {
    const isPositionActive = Utils.IsPositionActive(1);
    let result = isPositionActive({
      liquidity: "1",
      tickLower: "0",
      tickUpper: "1"
    });
    assert.ok(!result);
    result = isPositionActive({
      liquidity: "1",
      tickLower: "0",
      tickUpper: "2"
    });
    assert.ok(result);
    result = isPositionActive({
      liquidity: "0",
      tickLower: "0",
      tickUpper: "1"
    });
    assert.ok(!result);
    result = isPositionActive({
      liquidity: "1",
      tickLower: "1",
      tickUpper: "1"
    });
    assert.ok(!result);
    result = isPositionActive({
      liquidity: "1",
      tickLower: "-1",
      tickUpper: "1"
    });
    assert.ok(!result);
  });
  it("percent", function() {
    let result;
    result = Utils.percent("1", "2");
    assert.equal(result, "500000000000000000");
    result = Utils.percent("1", "2", "10");
    assert.equal(result, "5");
  });
  it("percentShares", function() {
    const input = {
      a: "1",
      b: "3"
    };
    const result = Utils.percentShares(input, undefined, "100");
    assert.deepEqual(result, {
      a: "25",
      b: "75"
    });
  });
});
