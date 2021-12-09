import dotenv from "dotenv";
import assert from "assert";
import { ethers } from "ethers";
import { LpFeeCalculator } from "..";
import { Provider } from "@ethersproject/providers";
import { toWei } from "../utils";

dotenv.config();

const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const wethPool = "0x7355Efc63Ae731f584380a9838292c7046c1e433";

describe("Relay Client", function () {
  let provider: Provider;
  beforeAll(async () => {
    provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
  });
  test("get fees", async () => {
    const calculator = new LpFeeCalculator(provider);
    const timestamp = Math.floor(Date.now() / 1000) - 60 * 10;
    const amount = toWei(10);
    const result = await calculator.getLpFeePct(wethAddress, wethPool, amount, timestamp);
    assert.ok(result);
  });
});
