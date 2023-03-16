require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";

const address = "0xee3afe347d5c74317041e2618c49534daf887c24";
const requester = "0x3BFf7fD5AACb1a22e1dd3ddbd8cfB8622A9E9A5B";
const identifier = "0x4d584e5553440000000000000000000000000000000000000000000000000000";
const ancillaryData = "0x00";
const timestamp = 1659179901;
assert(process.env.PROVIDER_URL_137, "requires PROVIDER_URL_137");
// these require integration testing, skip for ci
describe("OptimisticOracleV2", function () {
  let client: Client.Instance;
  test("inits", function () {
    const provider = ethers.providers.getDefaultProvider(process.env.PROVIDER_URL_137);
    client = Client.connect(address, provider);
    assert.ok(client);
  });
  test("getEventState", async function () {
    const events = await client.queryFilter({});
    const state = await Client.getEventState(events);
    assert.ok(Object.values(state.requests || {}).length);
  });
  test("get request", async function () {
    const request = await client.getRequest(requester, identifier, timestamp, ancillaryData);
    assert.ok(request);
  });
});
