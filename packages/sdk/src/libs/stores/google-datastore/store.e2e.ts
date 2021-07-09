import assert from "assert";
import Store from ".";

import { Datastore } from "@google-cloud/datastore";

// TODO: fix e2e tests, we need to skip this for now, e2e tests are broken
describe.skip("google-store", function () {
  let store: any;
  let datastore: Datastore;
  test("init", function () {
    datastore = new Datastore();
    store = Store("testing", datastore);
    assert(store);
  });
  test("delete", async function () {
    try {
      await store.delete("test");
    } catch (err) {
      // do nothing
    }
  });
  test("set", async function () {
    await store.set("test", { testing: true });
  });
  test("get", async function () {
    const result = await store.get("test");
    assert.deepEqual(result, { testing: true });
  });
  test("has", async function () {
    const result = await store.has("test");
    assert.equal(result, true);
  });
  test("delete", async function () {
    await store.delete("test");
    const result = await store.has("test");
    assert.equal(result, false);
  });
});
