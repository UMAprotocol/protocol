import * as utils from "./utils";
import assert from "assert";
import { ethers } from "ethers";

const { parseUnits } = ethers.utils;

describe("utils", function () {
  it("asyncValues", async function () {
    const result = await utils.asyncValues({
      a: null,
      b: 1,
      c: async () => "ok",
    });
    assert.equal(result.a, null);
    assert.equal(result.b, 1);
    assert.equal(result.c, "ok");
  });
  it("calculateGcr", function () {
    let input = {
      // gcr is collateral / tokens
      totalTokensOutstanding: "1",
      totalPositionCollateral: "10",
      tokenDecimals: 8,
      collateralDecimals: 8,
    };
    let result = utils.calcGcr(input).toString();
    assert.equal(result, "10000000000000000000");
    input = {
      totalTokensOutstanding: "10",
      totalPositionCollateral: "10",
      tokenDecimals: 8,
      collateralDecimals: 8,
    };
    result = utils.calcGcr(input).toString();
    assert.equal(result, "1000000000000000000");

    input = {
      totalTokensOutstanding: "100",
      totalPositionCollateral: "10",
      tokenDecimals: 8,
      collateralDecimals: 8,
    };
    result = utils.calcGcr(input).toString();
    assert.equal(result, "100000000000000000");

    input = {
      totalTokensOutstanding: "100000000",
      totalPositionCollateral: "1000000000000000000",
      tokenDecimals: 8,
      collateralDecimals: 18,
    };
    result = utils.calcGcr(input).toString();
    assert.equal(result, "1000000000000000000");

    input = {
      totalTokensOutstanding: "1000000000000000000",
      totalPositionCollateral: "100000000",
      tokenDecimals: 18,
      collateralDecimals: 8,
    };
    result = utils.calcGcr(input).toString();
    assert.equal(result, "1000000000000000000");
  });
  it("calculateTvl", function () {
    const emp = {
      totalPositionCollateral: parseUnits("100", 8).toString(),
      collateralDecimals: 8,
    };
    const price = parseUnits("0.25").toString();
    const result = utils.calcTvl(price, emp).toString();
    assert.equal(result, parseUnits("25").toString());
  });
  it("calcSyntheticPrice", function () {
    // stablecoin emp, minted 100k usd with eth collateral
    const collateralPrice = parseUnits("2000");
    const syntheticPrice = parseUnits(".0005");

    const result = utils.calcSyntheticPrice(syntheticPrice, collateralPrice);
    assert.equal(result.toString(), parseUnits("1").toString());
  });
});
