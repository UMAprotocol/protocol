import assert from "assert";
import Store from ".";

import { Datastore } from "@google-cloud/datastore";

type Price = {
  id?: string;
  timestamp: number;
  identifier: string;
  price: number;
};
function makeId(data: Price) {
  return [data.identifier, data.timestamp.toString().padStart(4, "0")].join("!");
}
const prices: Price[] = [
  { timestamp: 10, identifier: "a", price: 100 },
  { timestamp: 11, identifier: "a", price: 99 },
  { timestamp: 9, identifier: "a", price: 98 },
  { timestamp: 2, identifier: "a", price: 82 },
  { timestamp: 13, identifier: "a", price: 101 },

  { timestamp: 10, identifier: "b", price: 1000 },
  { timestamp: 11, identifier: "b", price: 990 },
  { timestamp: 9, identifier: "b", price: 980 },
  { timestamp: 2, identifier: "b", price: 820 },
  { timestamp: 13, identifier: "b", price: 1001 },
];
describe("google-store", function () {
  let store: any;
  let datastore: Datastore;
  test("init", function () {
    datastore = new Datastore();
    store = Store("testing-prices", datastore);
    assert(store);
  });
  test("clear", async function () {
    try {
      await store.clear();
    } catch (err) {
      console.log(err);
      // do nothing
    }
  });
  test("add prices", async () => {
    for (const price of prices) {
      await store.set(makeId(price), price);
    }
  });
  test("entries", async function () {
    const result = await store.entries();
    assert.equal(result.length, prices.length);
  });
  test("get", async function () {
    const result = await store.get(makeId(prices[0]));
    assert.deepEqual(result, prices[0]);
  });
  test("has", async function () {
    let result = await store.has(makeId(prices[0]));
    assert.equal(result, true);

    result = await store.has("dne");
    assert.equal(result, false);
  });
  // not supported
  test("size", async function () {
    try {
      await store.size();
    } catch (err) {
      assert.ok(err);
    }
  });
  test("between a", async () => {
    const result = await store.between("a", "b");
    let last: Price;
    assert.equal(result.length, 5);
    result.forEach((price: Price) => {
      assert.equal(price.identifier, "a");
      if (last == null) {
        last = price;
        return;
      }
      assert.ok(makeId(price) >= makeId(last));
    });
  });
  test("between b", async () => {
    const result = await store.between("b", "b~");
    let last: Price;
    assert.equal(result.length, 5);
    result.forEach((price: Price) => {
      assert.equal(price.identifier, "b");
      if (last == null) {
        last = price;
        return;
      }
      assert.ok(makeId(price) >= makeId(last));
    });
  });
  test("slice", async () => {
    const result = await store.slice("a", 4);
    let last: Price;
    assert.equal(result.length, 4);
    result.forEach((price: Price) => {
      assert.equal(price.identifier, "a");
      if (last == null) {
        last = price;
        return;
      }
      assert.ok(makeId(price) >= makeId(last));
    });
  });
  test("delete", async function () {
    await store.delete(makeId(prices[0]));
    const result = await store.has(makeId(prices[0]));
    assert.equal(result, false);
  });
  test("clear", async function () {
    await store.clear();
  });
});
