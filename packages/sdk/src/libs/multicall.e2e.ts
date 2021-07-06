require("dotenv").config();
import assert from "assert";
import Multicall from "./multicall";
import { ethers } from "ethers";
import { emp } from "./clients";

// multicall contract deployed to mainnet
const address = "0xeefba1e63905ef1d7acba5a8513c70307c1ce441";
const empAddress = "0xd81028a6fbAAaf604316F330b20D24bFbFd14478";
// these require integration testing, skip for ci
describe("multicall", function () {
  let provider: ethers.providers.BaseProvider;
  let multicall: Multicall;
  let empClient: emp.Instance;
  test("inits", function () {
    provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    multicall = new Multicall(address, provider);
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
    const parentResult = await multicall.read();
    assert.equal(parentResult.length, 0);
  });
  test("multicall add read replace", async function () {
    let multicallchild = multicall.add(empClient, { method: "priceIdentifier" });

    multicallchild = multicallchild.add(empClient, { method: "tokenCurrency" });
    multicallchild = multicallchild.add(empClient, { method: "collateralCurrency" });

    const result = await multicallchild.read();

    assert.equal(result.length, 3);

    // ensure that chained calls did not affect parent state
    const parentResult = await multicall.read();
    assert.equal(parentResult.length, 0);
  });
  test("multicall add read", async function () {
    const calls: [string][] = [["priceIdentifier"], ["tokenCurrency"], ["collateralCurrency"]];
    // reset multicall
    multicall = new Multicall(address, provider);
    const result = await multicall
      .batch(
        empClient,
        calls.map(([method]) => {
          return { method };
        })
      )
      .read();
    assert.equal(result.length, calls.length);

    // ensure that chained calls did not affect parent state
    const parentResult = await multicall.read();
    assert.equal(parentResult.length, 0);
  });
});
