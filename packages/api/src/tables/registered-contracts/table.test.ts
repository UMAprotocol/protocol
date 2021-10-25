import assert from "assert";
import { Table } from ".";

describe("registered emps table", function () {
  let table: Table;
  it("init", function () {
    table = Table();
    assert.ok(table);
  });
  it("create", async function () {
    const result = await table.create({
      id: "0x",
      address: "0x",
    });
    assert.ok(result.id);
  });
  it("values", async function () {
    const result = await table.values();
    assert.equal(result.length, 1);
  });
});
