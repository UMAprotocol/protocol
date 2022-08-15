import dotenv from "dotenv";
import assert from "assert";

import { Client } from "../client";
import factory from "../optimisticV2Factory";
import { getFlags, getAddress } from "../utils";
import Store from "../store";
import * as types from "../types";

dotenv.config();
assert(process.env.PROVIDER_URL_137, "requires PROVIDER_URL_137");

const optimisticOracleAddress = getAddress("0xee3afe347d5c74317041e2618c49534daf887c24");
const providerUrl = process.env.PROVIDER_URL_137;
const chainId = 137;

export const config = {
  chains: {
    [chainId]: {
      chainName: "eth",
      optimisticOracleAddress,
      // dont know why typescript cant figure this out
      rpcUrls: [providerUrl] as [string],
      blockExplorerUrls: ["a"] as [string],
      nativeCurrency: {
        name: "Eth",
        symbol: "Eth",
        decimals: 18,
      },
    },
  },
};

const address = getAddress("0xee3afe347d5c74317041e2618c49534daf887c24");
const signer = {} as types.ethers.JsonRpcSigner;
const provider = {} as types.ethers.Web3Provider;

const request = {
  address: "0xee3afe347d5c74317041e2618c49534daf887c24",
  requester: "0x3BFf7fD5AACb1a22e1dd3ddbd8cfB8622A9E9A5B",
  identifier: "0x4d584e5553440000000000000000000000000000000000000000000000000000",
  ancillaryData: "0x00",
  timestamp: 1659179901,
  chainId,
};

describe("Oracle V2 Client", function () {
  let client: Client;
  let store: Store;
  beforeAll(function () {
    client = factory(config, () => undefined);
    store = client.store;
    client.startInterval();
  });
  afterAll(function () {
    client.stopInterval();
  });
  test("setRequest", async function () {
    const id = client.setActiveRequest(request);
    await client.sm.tick();
    await client.sm.tick();
    const input = store.read().inputRequest();
    assert.ok(input);
    assert.ok(store.read().command(id));
  });
  test("setUser", async function () {
    const id = client.setUser({ address, chainId, signer, provider });
    await client.sm.tick();
    await client.sm.tick();
    const state = store.get();
    assert.ok(state?.inputs?.user);
    assert.equal(state?.inputs?.user?.address, address);
    assert.equal(state?.inputs?.user.chainId, chainId);
    assert.ok(store.read().command(id));
  });
  test("read", function () {
    store.read().request();
    store.read().oracleAddress();
    store.read().userCollateralBalance();
    store.read().userCollateralAllowance();
  });
  test("flags", function () {
    const result = getFlags(store.get());
    assert.ok(result);
    assert.ok(!result[types.state.Flag.WrongChain]);
    assert.ok(!result[types.state.Flag.MissingRequest]);
    assert.ok(!result[types.state.Flag.MissingUser]);
    assert.ok(result[types.state.Flag.CanPropose]);
    assert.ok(!result[types.state.Flag.CanDispute]);
    assert.ok(!result[types.state.Flag.CanSettle]);
    assert.ok(!result[types.state.Flag.RequestSettled]);
    assert.ok(result[types.state.Flag.InsufficientApproval]);
  });
});
