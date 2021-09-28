import assert from "assert";
import { Table } from "./table";
import type { Data } from "./utils";

describe("emp history", function () {
  let table: ReturnType<typeof Table>;
  it("should init", function () {
    table = Table();
    assert.ok(table);
  });
  it("should set initial data", async function () {
    const data = [
      { timestamp: 10, address: "a", value: "0" },
      { timestamp: 9, address: "a", value: "0" },
      { timestamp: 8, address: "a", value: "0" },
      { timestamp: 0, address: "a", value: "0" },
      { timestamp: 1, address: "a", value: "0" },
      { timestamp: 10, address: "b", value: "0" },
      { timestamp: 9, address: "b", value: "0" },
      { timestamp: 8, address: "b", value: "0" },
      { timestamp: 0, address: "c", value: "0" },
      { timestamp: 1, address: "c", value: "0" },
    ];
    await Promise.all(data.map(table.create));
    assert.equal(await table.size(), data.length);
  });
  it("should get all data for address", async function () {
    let result = await table.getAllByAddress("a");
    assert.equal(result.length, 5);
    result = await table.getAllByAddress("b");
    assert.equal(result.length, 3);
    result = await table.getAllByAddress("c");
    assert.equal(result.length, 2);
  });
  it("should get between by address", async function () {
    const result = await table.betweenByAddress("a", 1, 9);
    let plan = 2;
    result.forEach((sample: Data) => {
      plan--;
      assert(sample.timestamp >= 1);
      assert(sample.timestamp < 9);
      assert.equal(sample.address, "a");
    });
    assert.equal(plan, 0);
  });
  it("should slice by address", async function () {
    const result = await table.sliceByAddress("b", 0, 4);
    let plan = 3;
    result.forEach((sample: Data) => {
      plan--;
      assert.equal(sample.address, "b");
    });
    assert.equal(plan, 0);
  });
});
