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
function sortPrices(a: Price, b: Price) {
  return makeId(a) <= makeId(b) ? -1 : 1;
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
const sortedPrices = [...prices].sort(sortPrices);

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
  test("keys", async function () {
    const result = await store.keys();
    assert.equal(result.length, prices.length);
    result.forEach((id: string, i: number) => {
      assert.equal(id, makeId(sortedPrices[i]));
    });
  });
  test("values", async function () {
    const result = await store.values();
    assert.equal(result.length, prices.length);
    result.forEach((price: Price, i: number) => {
      assert.equal(price.identifier, sortedPrices[i].identifier);
      assert.equal(price.timestamp, sortedPrices[i].timestamp);
      assert.equal(price.price, sortedPrices[i].price);
    });
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
    const answer = sortedPrices.filter((x) => x.identifier === "a");
    assert.equal(result.length, 5);
    result.forEach((price: Price, i: number) => {
      assert.equal(price.identifier, answer[i].identifier);
      assert.equal(price.timestamp, answer[i].timestamp);
      assert.equal(price.price, answer[i].price);
    });
  });
  test("between b", async () => {
    const result = await store.between("b", "b~");
    const answer = sortedPrices.filter((x) => x.identifier === "b");
    assert.equal(result.length, 5);
    result.forEach((price: Price, i: number) => {
      assert.equal(price.identifier, answer[i].identifier);
      assert.equal(price.timestamp, answer[i].timestamp);
      assert.equal(price.price, answer[i].price);
    });
  });
  test("slice a", async () => {
    const len = 4;
    const result = await store.slice("a", len);
    assert.equal(result.length, len);

    const answer = sortedPrices.filter((x) => x.identifier === "a").slice(0, len);
    result.forEach((price: Price, i: number) => {
      assert.equal(price.identifier, answer[i].identifier);
      assert.equal(price.timestamp, answer[i].timestamp);
      assert.equal(price.price, answer[i].price);
    });
  });
  test("slice b", async () => {
    const len = 3;
    const result = await store.slice("b", len);
    assert.equal(result.length, len);

    const answer = sortedPrices.filter((x) => x.identifier === "b").slice(0, len);
    result.forEach((price: Price, i: number) => {
      assert.equal(price.identifier, answer[i].identifier);
      assert.equal(price.timestamp, answer[i].timestamp);
      assert.equal(price.price, answer[i].price);
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
