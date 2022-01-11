import dotenv from "dotenv";
import assert from "assert";

import factory, { Client } from "../client";
import Store from "../store";
import * as types from "../types";

dotenv.config();
assert(process.env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");

const multicall2Address = "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696";
const optimisticOracleAddress = "0xC43767F4592DF265B4a9F1a398B97fF24F38C6A6";
const providerUrl = process.env.CUSTOM_NODE_URL;
const chainId = 1;

export const config: types.state.Config = {
  chains: {
    [chainId]: {
      chainId,
      multicall2Address,
      optimisticOracleAddress,
      providerUrl,
    },
  },
};

const account = "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D";
const signer = {} as types.ethers.Signer;

const request = {
  requester: "0xb8b3583f143b3a4c2aa052828d8809b0818a16e9",
  identifier: "0x554D415553440000000000000000000000000000000000000000000000000000",
  timestamp: 1638453600,
  ancillaryData: "0x747761704C656E6774683A33363030",
  chainId,
};

describe("Oracle Client", function () {
  let client: Client;
  let store: Store;
  beforeAll(function () {
    client = factory(config, () => undefined);
    store = client.store;
  });
  test("setRequest", function () {
    client.setActiveRequest(request);
    const input = store.read().inputRequest();
    assert.ok(input);
  });
  test("setUser", function () {
    client.setUser(account, chainId, signer);
    const state = store.get();
    assert.ok(state.user);
    assert.equal(state.user.address, account);
    assert.equal(state.user.chainId, chainId);
  });
  test("update.all", async function () {
    await client.update.all();
    assert.ok(store.read().userCollateralBalance());
    assert.ok(store.read().userCollateralAllowance());
    assert.ok(store.read().collateralProps());
    assert.ok(store.read().request());
  });
});
