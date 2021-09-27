import assert from "assert";
import { Table } from ".";

const block = {
  number: 0,
  timestamp: 10,
  hash: "hash",
};
describe("block map table", function () {
  let table: any;
  test("init", function () {
    table = Table();
    assert.ok(table);
  });
  test("create", async function () {
    const result = await table.create(block);
    assert.equal(result.id, block.number);
  });
  test("has", async function () {
    let has = await table.has(block.number);
    assert.ok(has);
    has = await table.has(1);
    assert.ok(!has);
  });
  test("prune", async function () {
    const deleted = await table.prune(11);
    assert.ok(deleted);
    assert.equal(deleted.length, 1);
    assert.deepEqual(deleted[0], { id: block.number, ...block });
    const has = await table.has(block.number);
    assert.ok(!has);
  });
});
