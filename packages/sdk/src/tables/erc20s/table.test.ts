import assert from "assert";
import { Table } from ".";

describe("block map table", function () {
  let table: any;
  test("init", function () {
    table = Table();
    assert.ok(table);
  });
  test("create", async function () {
    const token = {
      address: "a",
    };
    const result = await table.getOrCreate(token.address);
    assert.equal(result.id, token.address);
  });
  test("upsert", async function () {
    const address = "b";
    const update = {
      name: "tokenb",
    };
    const result = await table.upsert(address, update);
    assert.equal(result.id, address);
    assert.equal(result.name, update.name);
  });
});
