import assert from "assert";
import { Table } from ".";

describe("tvl table", function () {
  let table: Table;
  it("init", function () {
    table = Table();
    assert.ok(table);
  });
  it("create", async function () {
    const result = await table.create({
      id: 1,
      timestamp: 16300011,
      value: "21331",
    });
    assert.ok(result.id);
  });
  it("values", async function () {
    const result = await table.values();
    assert.equal(result.length, 1);
  });
});
