import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";
import { emp } from "..";
import dotenv from "dotenv";

dotenv.config();
// multicall contract deployed to mainnet
const address = "0x5ba1e12693dc8f9c48aad8770482f4739beed696";
const empAddress = "0x4E3168Ea1082f3dda1694646B5EACdeb572009F1";
// these require integration testing, skip for ci
describe("multicall2", function () {
  let client: Client.Instance;
  let empClient: emp.Instance;

  test("inits", function () {
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    client = Client.connect(address, provider);
    empClient = emp.connect(empAddress, provider);
    assert.ok(client);
    assert.ok(empClient);
  });

  test("multicall2 on emp", async function () {
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

  test("multicall2 on emp with no errors", async function () {
    const calls = ["priceIdentifier", "tokenCurrency", "collateralCurrency"];
    const multicalls = calls.map((call: any) => {
      return {
        target: empAddress,
        callData: empClient.interface.encodeFunctionData(call),
      };
    });
    const response = await client.callStatic.tryBlockAndAggregate(false, multicalls);
    const decoded = calls.map((call: any, i: number) => {
      const result = response.returnData[i].returnData;
      return empClient.interface.decodeFunctionResult(call, result);
    });
    assert.equal(decoded.length, calls.length);
  });

  test("multicall2 on emp with errors", async function () {
    const calls = ["priceIdentifier", "tokenCurrency", "disputeBondPercentage"];
    const multicalls = calls.map((call) => ({
      target: empAddress,
      callData: empClient.interface.encodeFunctionData(call as any),
    }));
    const response = await client.callStatic.tryBlockAndAggregate(false, multicalls);
    const decoded: ethers.utils.Result[] = [];
    const failedCalls: string[] = [];

    for (let i = 0; i < calls.length; i++) {
      const result = response.returnData[i].returnData;
      const call = calls[i];

      if (response.returnData[i].success) {
        decoded.push(empClient.interface.decodeFunctionResult(call as any, result));
      } else {
        failedCalls.push(call);
      }
    }
    assert.ok(decoded.length === 2 && failedCalls.length == 1);
  });
});
