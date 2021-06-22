require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";

const address = "0xd81028a6fbAAaf604316F330b20D24bFbFd14478";
// these require integration testing, skip for ci
describe("emp", function () {
  let client: Client.Instance;
  test("inits", function () {
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    client = Client.connect(address, provider);
    assert.ok(client);
  });
  test("getEventState between", async function () {
    const events = await client.queryFilter({}, 0, 12477952);
    assert.ok(events.length);
  });
  test("getEventState", async function () {
    const events = await client.queryFilter({});
    const state = await Client.getEventState(events);
    assert.ok(state.tokens);
    assert.ok(Object.keys(state.tokens).length);
    assert.ok(state.collateral);
    assert.ok(Object.keys(state.collateral).length);
    assert.ok(state.sponsors);
    assert.ok(state.sponsors.length);
  });
});
