import Client from "./action-client";
import type { Client as ClientType } from "./action-client";
import assert from "assert";
describe("action client", function () {
  let client: ClientType;
  it("init", function () {
    client = Client("http://localhost:8282", "emp");
    assert.ok(client);
  });
  // these test requires integration testing setup with API running. disable for ci
  it("echo", async function () {
    const result = await client("echo", "test");
    assert.deepEqual(result, ["test"]);
  });
  it("error", async function () {
    let plan = 1;
    try {
      await client("dne", "test");
    } catch (err) {
      plan--;
      assert.ok(err);
    }
    assert.equal(plan, 0);
  });
});
