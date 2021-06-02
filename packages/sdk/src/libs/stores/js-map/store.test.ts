import assert from "assert";
import Store from ".";
import type { Store as StoreType } from "..";

describe("map store", function () {
  let store: StoreType<string, string>;
  test("init", function () {
    store = Store<string, string>();
    assert.ok(store);
  });
  test("set", async function () {
    await store.set("a", "a");
  });
  test("get", async function () {
    const result = await store.get("a");
    assert.equal(result, "a");
  });
  test("has", async function () {
    const result = await store.has("a");
    assert.equal(result, true);
  });
  test("delete", async function () {
    await store.delete("a");
    const result = await store.has("a");
    assert.equal(result, false);
  });
});
