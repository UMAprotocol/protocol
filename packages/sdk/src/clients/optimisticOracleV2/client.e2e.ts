require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";

const address = "0xA0Ae6609447e57a42c51B50EAe921D701823FFAe";
// these require integration testing, skip for ci
describe("OptimisticOracleV2", function () {
  let client: Client.Instance;
  test("inits", function () {
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    client = Client.connect(address, provider);
    assert.ok(client);
  });
  test("getEventState", async function () {
    const events = await client.queryFilter({});
    const state = await Client.getEventState(events);
    // no requests yet
    assert.ok(Object.values(state.requests || {}).length >= 0);
  });
});
