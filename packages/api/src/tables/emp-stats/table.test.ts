import assert from "assert";
import { Table } from ".";

describe("emp stat table", function () {
  let table: any;
  it("init", function () {
    table = Table();
    assert.ok(table);
  });
  it("create", async function () {
    const data = {
      address: "a",
    };
    const result = await table.getOrCreate(data.address);
    assert.equal(result.id, data.address);
  });
  it("upsert", async function () {
    const address = "b";
    const update = {
      tvl: "100",
    };
    const result = await table.upsert(address, update);
    assert.equal(result.id, address);
    assert.equal(result.tvl, update.tvl);
  });
});
