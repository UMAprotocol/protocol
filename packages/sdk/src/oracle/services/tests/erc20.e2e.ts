import dotenv from "dotenv";
import assert from "assert";
import { ethers } from "ethers";
import { Provider } from "@ethersproject/providers";
import { factory, Erc20 } from "../erc20";
import { MULTICALL2_ADDRESS } from "../../constants";

dotenv.config();

const wethAddress = "0x7355Efc63Ae731f584380a9838292c7046c1e433";

describe("Erc20 E2E", function () {
  let provider: Provider;
  let erc20: Erc20;
  beforeAll(async () => {
    provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
  });
  describe("Erc20", function () {
    beforeAll(async () => {
      erc20 = factory(provider, wethAddress);
    });
    test("getProps", async function () {
      jest.setTimeout(30000);
      const result = await erc20.getProps();
      assert.ok(result.symbol);
      assert.ok(result.name);
      assert.ok(result.decimals);
      assert.ok(result.totalSupply.toString());
    });
  });
  describe("Erc20Multicall", function () {
    beforeAll(async () => {
      erc20 = factory(provider, wethAddress, MULTICALL2_ADDRESS);
    });
    test("getProps", async function () {
      jest.setTimeout(30000);
      const result = await erc20.getProps();
      assert.ok(result.symbol);
      assert.ok(result.name);
      assert.ok(result.decimals);
      assert.ok(result.totalSupply.toString());
    });
  });
});
