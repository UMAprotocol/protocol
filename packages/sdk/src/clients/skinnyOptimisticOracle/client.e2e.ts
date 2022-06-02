require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";

const address = "0xeE3Afe347D5C74317041E2618C49534dAf887c24";
// these require integration testing, skip for ci
describe("SkinnyOptimisticOracle", function () {
  let client: Client.Instance;
  test("inits", function () {
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    client = Client.connect(address, provider);
    assert.ok(client);
  });
  test("getEventState", async function () {
    const events = await client.queryFilter({});
    const state = await Client.getEventState(events);
    assert.ok(Object.values(state.requests || {}).length > 0);
  });
});
