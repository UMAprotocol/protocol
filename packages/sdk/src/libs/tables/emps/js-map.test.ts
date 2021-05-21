import assert from "assert";
import { JsMap } from ".";

describe("emp js-map", function () {
  let table: ReturnType<typeof JsMap>;
  test("init", function () {
    table = JsMap();
    assert.ok(table);
  });
  test("create", async function () {
    const result = await table.create({
      address: "a",
    });
    assert.ok(result.id);
    await table.create({
      address: "b",
    });
    assert.ok(result.id);
  });
  test("values", async function () {
    const result = await table.values();
    assert.equal(result.length, 2);
  });
});
