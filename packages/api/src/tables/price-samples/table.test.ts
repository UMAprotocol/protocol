import assert from "assert";
import { Table } from ".";

describe("price samples table", function () {
  let table: Table;
  it("init", function () {
    table = Table();
    assert.ok(table);
  });
  it("create", async function () {
    const result = await table.create({
      address: "0x",
      timestamp: 16300011,
      price: "21331",
    });
    assert.ok(result.id);
  });
  it("values", async function () {
    const result = await table.values();
    assert.equal(result.length, 1);
  });
});
