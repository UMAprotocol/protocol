require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";

// these require integration testing, skip for ci
describe("lsp creator", function () {
  let client: Client.Instance;
  test("inits", async function () {
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    const address = await Client.getAddress(1);
    client = Client.connect(address, provider);
    assert.ok(client);
  });
  test("getEventState", async function () {
    const events = await client.queryFilter({});
    const state = await Client.getEventState(events);
    assert.ok(state.contracts);
    assert.ok(Object.keys(state.contracts).length > 0);
  });
});
