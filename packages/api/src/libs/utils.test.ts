import * as utils from "./utils";
import assert from "assert";

describe("utils", function () {
  it("asyncValues", async function () {
    const result = await utils.asyncValues({
      a: null,
      b: 1,
      c: async () => "ok",
    });
    assert.equal(result.a, null);
    assert.equal(result.b, 1);
    assert.equal(result.c, "ok");
  });
});
