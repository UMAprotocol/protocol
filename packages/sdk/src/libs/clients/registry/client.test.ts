require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { RegistryInstance } from "../../index.d";
import { ethers } from "ethers";

describe("emp factory", function () {
  let client: RegistryInstance;
  test("inits", function () {
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    const address = Client.getAddress("1");
    client = Client.connect(address, provider);
    assert.ok(client);
  });
  test("getEventState between", async function () {
    const events = await client.queryFilter(client.filters.NewContractRegistered(null, null, null), 0, 12477952);
    assert.ok(events.length);
  });
  test("getEventState", async function () {
    const events = await client.queryFilter({});
    const state = await Client.getEventState(events);
    assert.ok(state.contracts);
  });
});
