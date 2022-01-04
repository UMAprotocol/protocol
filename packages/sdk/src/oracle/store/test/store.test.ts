import assert from "assert";
import Store from "..";
import Events from "events";
import { BigNumber } from "ethers";

describe("Oracle Store", function () {
  let store: Store;
  let events: Events;
  beforeAll(function () {
    events = new Events();
    store = new Store(events.emit.bind(events, "change"));
  });

  test("set user", function (done) {
    events.once("change", (state) => {
      assert.equal(state.user.address, "test");
      assert.equal(state.user.chainId, 1);
      done();
    });
    store.write((write) => write.user().set({ address: "test", chainId: 1 }));
  });
  test("set input", function (done) {
    events.once("change", (state) => {
      assert.equal(state.inputs.request.requester, "a");
      assert.equal(state.inputs.request.identifier, "b");
      assert.equal(state.inputs.request.timestamp, 1);
      assert.equal(state.inputs.request.ancillaryData, "d");
      done();
    });
    store.write((write) => write.inputs().request("a", "b", 1, "d"));
  });
  test("set balance", function (done) {
    events.once("change", (state) => {
      assert.ok(state.chains?.[1]?.erc20s?.test?.balances?.user1?.eq(1));
      done();
    });
    store.write((write) => write.chains(1).erc20s("test").balance("user1", BigNumber.from(1)));
  });
  test("set allowance", function (done) {
    events.once("change", (state) => {
      assert.ok(state.chains?.[1]?.erc20s?.test?.allowances?.oracle?.user1?.eq(1));
      done();
    });
    store.write((write) => write.chains(1).erc20s("test").allowance("user1", "oracle", BigNumber.from(1)));
  });
});
