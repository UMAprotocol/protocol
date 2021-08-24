require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";
import { emp } from "..";

// multicall contract deployed to mainnet
const multicallV1Address = "0xeefba1e63905ef1d7acba5a8513c70307c1ce441";
const multicallV2Address = "0x5ba1e12693dc8f9c48aad8770482f4739beed696";
const empAddress = "0xd81028a6fbAAaf604316F330b20D24bFbFd14478";
// these require integration testing, skip for ci
describe("multicall", function () {
  let clientV1: Client.Instance;
  let clientV2: Client.Instance;
  let empClient: emp.Instance;
  test("inits", function () {
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    clientV1 = Client.connect(multicallV1Address, provider);
    clientV2 = Client.connect(multicallV2Address, provider);
    empClient = emp.connect(empAddress, provider);
    assert.ok(clientV1);
    assert.ok(clientV2);
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
    const response = await clientV1.callStatic.aggregate(multicalls);
    const decoded = calls.map((call: any, i: number) => {
      const result = response.returnData[i];
      return empClient.interface.decodeFunctionResult(call, result);
    });
    assert.equal(decoded.length, calls.length);
  });

  test("multicall2 on emp", async function () {
    const calls = ["priceIdentifier", "tokenCurrency", "collateralCurrency"];
    const multicalls = calls.map((call: any) => {
      return {
        target: empAddress,
        callData: empClient.interface.encodeFunctionData(call),
      };
    });
    const response = await clientV2.callStatic.tryBlockAndAggregate(false, multicalls);
    const decoded = calls.map((call: any, i: number) => {
      const result = response.returnData[i];
      return empClient.interface.decodeFunctionResult(call, result[1]);
    });
    assert.equal(decoded.length, calls.length);
  });
});
