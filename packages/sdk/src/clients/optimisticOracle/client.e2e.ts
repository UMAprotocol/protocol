require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";

const address = "0xc43767f4592df265b4a9f1a398b97ff24f38c6a6";
// these require integration testing, skip for ci
describe("OptimisticOracle", function () {
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
