import Table from ".";
import { default as JsMapStore } from "../../stores/js-map";
import assert from "assert";
import type { Store } from "../../stores";

type D = {
  id: string;
  [key: string]: string;
};
describe("basic table", function () {
  let table: any;
  let store: any;
  test("init", function () {
    store = JsMapStore<string, D>();
    table = Table<string, D, Store<string, D>>({ makeId: (x: D) => x.id, type: "test" }, store);
    assert.ok(table);
  });
  test("create", async function () {
    const data: D = { id: "s", optional: "yes" };
    const result = await table.create(data);
    assert.deepEqual(result, data);
  });
});
