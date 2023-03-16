import dotenv from "dotenv";
import assert from "assert";

import { Client } from "../client";
import factory from "../optimisticFactory";
import { getFlags } from "../utils";
import Store from "../store";
import * as types from "../types";

dotenv.config();
assert(process.env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");

const multicall2Address = "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696";
const optimisticOracleAddress = "0xC43767F4592DF265B4a9F1a398B97fF24F38C6A6";
const providerUrl = process.env.CUSTOM_NODE_URL;
const chainId = 1;

export const config = {
  chains: {
    [chainId]: {
      chainName: "eth",
      optimisticOracleAddress,
      multicall2Address,
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

const address = "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D";
const signer = {} as types.ethers.JsonRpcSigner;
const provider = {} as types.ethers.Web3Provider;

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
    assert.ok(!result[types.state.Flag.CanPropose]);
    assert.ok(!result[types.state.Flag.CanDispute]);
    assert.ok(!result[types.state.Flag.CanSettle]);
    assert.ok(result[types.state.Flag.RequestSettled]);
    assert.ok(result[types.state.Flag.InsufficientApproval]);
  });
  test("setActiveRequestByTransaction", async function (done) {
    const transactionHash = "0x91720719f4768e10849ebb5f41690488f7060e10534c5c4f15e69b7dc494502a";
    const chainId = 1;
    const id = client.setActiveRequestByTransaction({ transactionHash, chainId });
    const expectedExpiration = 1630368843;

    const stop = setInterval(() => {
      const result = store.read().command(id);
      if (result.done) {
        assert.ok(!result.error);
        assert.ok(store.read().request());
        assert.equal(store.read().request().expirationTime, expectedExpiration);
        clearInterval(stop);
        done();
      }
    }, 1000);
  });
  test("setActiveRequestByTransaction failure", async function (done) {
    const transactionHash = "0x91720719f4768e10849ebb5f41690488f7060e10534c5c4f15e69b7dc494502a";
    const chainId = 1;
    const eventIndex = 1;
    const id = client.setActiveRequestByTransaction({ transactionHash, chainId, eventIndex });

    const stop = setInterval(() => {
      const result = store.read().command(id);
      if (result.done) {
        assert.ok(result.error);
        clearInterval(stop);
        done();
      }
    }, 1000);
  });
});
