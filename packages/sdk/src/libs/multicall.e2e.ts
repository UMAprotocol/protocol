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
  test("multicall add read", async function () {
    multicall.add(empClient, "priceIdentifier");
    multicall.add(empClient, "tokenCurrency");
    multicall.add(empClient, "collateralCurrency");
    const result = await multicall.read();
    assert.equal(result.length, 3);
  });
  test("multicall add read", async function () {
    const calls: [string][] = [["priceIdentifier"], ["tokenCurrency"], ["collateralCurrency"]];
    // reset multicall
    multicall = new Multicall(address, provider);
    multicall.batch(empClient, calls);
    const result = await multicall.read();
    assert.equal(result.length, calls.length);
  });
});
