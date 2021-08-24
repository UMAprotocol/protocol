import assert from "assert";
import { JsMap } from ".";

describe("emp js-map", function () {
  let table: JsMap;
  it("init", function () {
    table = JsMap();
    assert.ok(table);
  });
  it("create", async function () {
    const result = await table.create({
      address: "a",
    });
    assert.ok(result.id);
    await table.create({
      address: "b",
    });
    assert.ok(result.id);
  });
  it("values", async function () {
    const result = await table.values();
    assert.equal(result.length, 2);
  });
  it("addSponsors", async function () {
    const result = await table.addSponsors("a", ["a", "b", "c", "a"]);
    assert.ok(result.sponsors);
    // one dupe, so 3 total
    assert.equal(result.sponsors.length, 3);
  });
});
