import dotenv from "dotenv";
import { Client, Provider } from "./bridgePool";
import { ethers } from "ethers";
import assert from "assert";
import set from "lodash/set";
import get from "lodash/get";

dotenv.config();

const multicall2Address = "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696";
const wethAddress = "0x75a29a66452C80702952bbcEDd284C8c4CF5Ab17";
const users = [
  "0x06d8aeb52f99f8542429df3009ed26535c22d5aa",
  "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D",
  "0x718648C8c531F91b528A7757dD2bE813c3940608",
];
describe("Client", function () {
  const state = {};
  let provider: Provider;
  let client: Client;
  beforeAll(async () => {
    provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    client = new Client({ multicall2Address }, { provider }, (path, data) => set(state, path, data));
  });
  test("read users", async function () {
    for (const userAddress of users) {
      await client.updateUser(userAddress, wethAddress);
      const user = get(state, ["users", userAddress, wethAddress]);
      const pool = get(state, ["pools", wethAddress]);
      assert.ok(pool);
      assert.ok(user);
    }
  });
  test("read pool", async function () {
    await client.updatePool(wethAddress);
    const result = get(state, ["pools", wethAddress]);
    console.log(result);
    assert.ok(result);
  });
});
