import assert from "assert";
import Store from ".";

type Price = {
  id?: string;
  timestamp: number;
  identifier: string;
  price: number;
};
function makeId(data: Price) {
  return [data.identifier, data.timestamp.toString().padStart(4, "0")].join("!");
}

describe("sorted map", () => {
  let map: any;
  test("init", () => {
    map = Store<string, Price>();
    assert.ok(map);
  });
  test("add prices", async () => {
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
    prices.forEach((price) => map.set(makeId(price), price));
    assert.equal(await map.size(), prices.length);
  });
  test("keys", async () => {
    const result = await map.keys();
    assert.ok(result);
    assert.ok(result.length);
  });
  test("between a", async () => {
    const result = await map.between("a", "b");
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
    const result = await map.between("b", "b~");
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
    const result = await map.slice("a", 4);
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
  test("delete", async () => {
    const keys = await map.keys();
    await map.delete(keys[0]);
    await map.delete(keys[0]);
    const result = await map.keys();
    assert.equal(result.length, keys.length - 1);
    for (const val of result) {
      assert.ok(await map.has(val));
    }
  });
});
