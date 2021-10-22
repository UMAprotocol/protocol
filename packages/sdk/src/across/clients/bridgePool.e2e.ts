import dotenv from "dotenv";
import { ReadClient, Provider } from "./bridgePool";
import { ethers } from "ethers";
import assert from "assert";

dotenv.config();

const multicall2Address = "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696";
const address = "0xf42bB7EC88d065dF48D60cb672B88F8330f9f764";
describe("BridgePool.ReadClient", function () {
  let client: any;
  let provider: Provider;
  beforeAll(async () => {
    provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    client = await ReadClient(address, provider, multicall2Address);
  });
  test("getPoolState", async function () {
    const result = await client();
    assert.ok(result.pool.totalPoolSize);
    assert.ok(result.pool.l1Token);
    assert.ok(result.pool.address);
  });
  test("getUserState", async function () {
    const result = await client("0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D");
    assert.ok(result.user.address);
    assert.ok(result.user.lpTokens);
    assert.ok(result.user.positionValue);
    assert.ok(result.user.totalDeposited);
    assert.ok(result.user.feesEarned);
  });
});
