require("dotenv").config();
import assert from "assert";
import Multicall2 from "./multicall2";
import { ethers } from "ethers";
import { emp } from "./clients";

// multicall contract deployed to mainnet
const address = "0x5ba1e12693dc8f9c48aad8770482f4739beed696";
const empAddress = "0x4E3168Ea1082f3dda1694646B5EACdeb572009F1";

// these require integration testing, skip for ci
describe("multicall2", function () {
  let provider: ethers.providers.BaseProvider;
  let multicall: Multicall2;
  let empClient: emp.Instance;
  test("inits", function () {
    provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    multicall = new Multicall2(address, provider);
    empClient = emp.connect(empAddress, provider);
    assert.ok(multicall);
    assert.ok(empClient);
  });
  test("multicall add read chain", async function () {
    const result = await multicall
      .add(empClient, { method: "priceIdentifier" })
      .add(empClient, { method: "tokenCurrency" })
      .add(empClient, { method: "collateralCurrency" })
      .read();

    assert.equal(result.length, 3);

    // ensure that chained calls did not affect parent state
    const parentResult = await multicall.readWithErrors();
    assert.equal(parentResult.length, 0);
  });
  test("multicall add read chain with errors", async function () {
    const result = await multicall
      .add(empClient, { method: "priceIdentifier" })
      .add(empClient, { method: "tokenCurrency" })
      .add(empClient, { method: "disputeBondPercentage" })
      .readWithErrors();
    assert.equal(result.length, 3);
    assert.equal(result.filter((resultItem) => resultItem.success).length, 2);
    // ensure that chained calls did not affect parent state
    const parentResult = await multicall.readWithErrors();
    assert.equal(parentResult.length, 0);
  });
});
