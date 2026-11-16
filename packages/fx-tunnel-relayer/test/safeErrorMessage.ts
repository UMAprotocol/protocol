import { assert } from "chai";
import { safeErrorMessage } from "../src/safeErrorMessage";

describe("safeErrorMessage", function () {
  it("redacts HTTP and WebSocket provider credentials from retry errors", function () {
    for (const scheme of ["http", "https", "ws", "wss"]) {
      const error = new Error(
        `Provider 0 at ${scheme}://user:password@example.invalid/api-secret?key=secret: unavailable`
      );
      assert.equal(safeErrorMessage(error), "Provider 0 at [redacted URL] unavailable");
    }
  });
  it("redacts serialized transaction data without copying nested error fields", function () {
    const data = "0x" + "ab".repeat(120_000);
    const error = Object.assign(new Error(`RPC error {"data":"${data}"}`), { data, proof: data });
    assert.equal(safeErrorMessage(error), 'RPC error {"data":"[redacted hex data]"}');
    assert.equal(safeErrorMessage({ data, proof: data }), "Unknown error");
  });
  it("bounds messages and accepts thrown strings", function () {
    assert.lengthOf(safeErrorMessage(new Error("x".repeat(3000))), 2048);
    assert.equal(safeErrorMessage("EXIT_ALREADY_PROCESSED"), "EXIT_ALREADY_PROCESSED");
    assert.equal(safeErrorMessage(undefined), "Unknown error");
  });
});
