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
  it("calculateTvm", function () {
    const emp = {
      totalTokensOutstanding: parseUnits("100", 8).toString(),
      tokenDecimals: 8,
    };
    const price = parseUnits("0.25").toString();
    const result = utils.calcTvm(price, emp).toString();
    assert.equal(result, parseUnits("25").toString());
  });
  it("calcSyntheticPrice", function () {
    // stablecoin emp, minted 100k usd with eth collateral
    const collateralPrice = parseUnits("2000");
    const syntheticPrice = parseUnits(".0005");

    const result = utils.calcSyntheticPrice(syntheticPrice, collateralPrice);
    assert.equal(result.toString(), parseUnits("1").toString());
  });
  it("parseEnvArray", function () {
    const lspCreatorAddresses =
      "0x0b8de441B26E36f461b2748919ed71f50593A67b , 0x60F3f5DDE708D097B7F092EFaB2E085AC0a82F42,0x31C893843685f1255A26502eaB5379A3518Aa5a9 ,0x9504b4ab8cd743b06074757d3B1bE3a3aF9cea10 ";
    const result = utils.parseEnvArray(lspCreatorAddresses);
    assert.equal(result.length, 4);
    let plan = result.length;
    result.forEach((address) => {
      plan--;
      assert.ok(ethers.utils.isAddress(address));
    });
    assert.equal(plan, 0);
  });
  it("BlockInterval", async function () {
    let plan = 1;
    async function update(start: number, end: number) {
      plan--;
      assert.equal(start, 1);
      assert.equal(end, 10);
    }
    const tick = utils.BlockInterval(update, 1);
    const result = await tick(10);
    assert.equal(result.startBlock, 1);
    assert.equal(result.endBlock, 10);
    assert.equal(plan, 0);
  });
});
