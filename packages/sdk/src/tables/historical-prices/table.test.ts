import assert from "assert";
import { Table, makeId } from ".";

const data = {
  timestamp: 10,
  price: "100",
};
describe("block map table", function () {
  let table: any;
  test("init", function () {
    table = Table();
    assert.ok(table);
  });
  test("create", async function () {
    const result = await table.create(data);
    assert.equal(result.id, makeId(data));
  });
  test("has", async function () {
    let has = await table.has(makeId(data));
    assert.ok(has);
    has = await table.has(1);
    assert.ok(!has);
  });
});
