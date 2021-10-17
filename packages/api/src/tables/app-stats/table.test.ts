import assert from "assert";
import { Table } from ".";

describe("app stats js-map", function () {
  let table: Table;
  it("init", function () {
    table = Table();
    assert.ok(table);
  });
  it("create", async function () {
    const result = await table.create({
      id: 1,
    });
    assert.ok(result.id);
  });
  it("values", async function () {
    const result = await table.values();
    assert.equal(result.length, 1);
  });
  it("setLastBlockUpdate", async function () {
    const result = await table.setLastBlockUpdate(10);
    assert.strictEqual(result.lastBlockUpdate, 10);
  });
});
