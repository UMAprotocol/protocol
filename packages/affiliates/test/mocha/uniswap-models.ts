import { assert } from "chai";
import * as Models from "../../libs/uniswap/models";

type TestData = {
  id: string;
  optional?: boolean;
};
function TestTable() {
  const makeId = (data: TestData) => data.id;
  const store = new Map<string, TestData>();
  return Models.Table<TestData>({ makeId, type: "test" }, store);
}
type TestTable = ReturnType<typeof TestTable>;

describe("Table", function () {
  let table: TestTable;
  it("init", function () {
    table = TestTable();
    assert.ok(table);
    assert.ok(table.store);
  });
  it("create", async function () {
    const data = { id: "0" };
    const result = await table.create(data);
    assert.equal(result.id, data.id);
  });
  it("has", async function () {
    const data = { id: "0" };
    const result = await table.has(data.id);
    assert.equal(result, true);
  });
  it("get", async function () {
    const data = { id: "0" };
    const result = await table.get(data.id);
    assert.deepEqual(result, data);
  });
  it("set", async function () {
    const data = { id: "1" };
    const result = await table.set(data);
    assert.deepEqual(result, data);
  });
  it("update", async function () {
    const data = { id: "1" };
    const result = await table.update(data.id, { optional: true });
    assert.ok(result.optional);
  });
  it("list", async function () {
    const result = await table.list();
    assert.equal(result.length, 2);
  });
  it("entries", async function () {
    const result = await table.entries();
    assert.equal(result.length, 2);
  });
  it("forEach", async function () {
    let plan = 2;
    await table.forEach((item) => {
      assert.ok(item.id);
      plan--;
    });
    assert.equal(plan, 0);
  });
});

describe("Balances", function () {
  let balances: Models.Balances;
  it("init", function () {
    balances = Models.Balances();
    assert.ok(balances);
  });
  it("create", function () {
    const result = balances.create("0");
    assert.equal(result, "0");
  });
  it("add", function () {
    const result = balances.add("0", "1");
    assert.equal(result, "1");
  });
  it("getOrCreate", function () {
    let result = balances.getOrCreate("0");
    assert.equal(result, "1");
    result = balances.getOrCreate("1");
    assert.equal(result, "0");
  });
  it("sub", function () {
    balances.add("1", "3");
    const result = balances.sub("1", "1");
    assert.equal(result, "2");
  });
  it("snapshot", function () {
    const result = balances.snapshot();
    assert.deepEqual(result, {
      "0": "1",
      "1": "2",
    });
  });
  it("getTotal", function () {
    const result = balances.getTotal();
    assert.equal(result, "3");
  });
});
