require("dotenv").config();
import assert from "assert";
import * as Client from "./client";
import { ethers } from "ethers";

const address = "0x651EcbFc3d03109Bb9B2183A068F61dF6935a15A";
// these require integration testing, skip for ci
describe("lsp", function () {
  let client: Client.Instance;
  test("inits", function () {
    const provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    client = Client.connect(address, provider);
    assert.ok(client);
  });
  test("getEventState", async function () {
    const events = await client.queryFilter({});
    const state = await Client.getEventState(events);
    assert.ok(state.collateral);
    assert.ok(state.shorts);
    assert.ok(state.longs);
  });
});
