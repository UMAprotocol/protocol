import Table from ".";
import Store from "../../stores/js-map";
import assert from "assert";

type D = {
  id: string;
  [any: string]: string;
};
describe("basic table", function () {
  let table: any, store: any;
  test("init", function () {
    store = Store<string, D>();
    table = Table<string, D>({ makeId: (x: D) => x.id, type: "test" }, store);
    assert.ok(table);
  });
  test("create", async function () {
    const data: D = { id: "s", optional: "yes" };
    const result = await table.create(data);
    assert.deepEqual(result, data);
  });
});
