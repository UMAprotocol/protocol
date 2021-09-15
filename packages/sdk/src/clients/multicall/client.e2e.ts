require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";
import { emp } from "..";

// multicall contract deployed to mainnet
const address = "0xeefba1e63905ef1d7acba5a8513c70307c1ce441";
const empAddress = "0xd81028a6fbAAaf604316F330b20D24bFbFd14478";
// these require integration testing, skip for ci
describe("multicall", function () {
  let client: Client.Instance;
  let empClient: emp.Instance;
  test("inits", function () {
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    client = Client.connect(address, provider);
    empClient = emp.connect(empAddress, provider);
    assert.ok(client);
    assert.ok(empClient);
  });

  test("multicall on emp", async function () {
    const calls = ["priceIdentifier", "tokenCurrency", "collateralCurrency"];
    const multicalls = calls.map((call: any) => {
      return {
        target: empAddress,
        callData: empClient.interface.encodeFunctionData(call),
      };
    });
    const response = await client.callStatic.aggregate(multicalls);
    const decoded = calls.map((call: any, i: number) => {
      const result = response.returnData[i];
      return empClient.interface.decodeFunctionResult(call, result);
    });
    assert.equal(decoded.length, calls.length);
  });
});
