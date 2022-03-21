import assert from "assert";
import * as errors from "../errors";
describe("Oracle Errors", function () {
  test("assertExists", function () {
    const message = "Value does not exist";
    let plan = 0;
    try {
      errors.assertExists(null, message);
    } catch (err) {
      assert.ok(err instanceof errors.ExistenceError);
      assert.equal(err.message, message);
      assert.equal(err.name, "ExistenceError");
      plan++;
    }
    try {
      throw new Error(message);
    } catch (err) {
      assert.ok(!(err instanceof errors.ExistenceError));
      plan++;
    }
    assert.equal(plan, 2);
  });
  test("ignoreExistenceError", function () {
    const a = errors.ignoreExistenceError(() => {
      throw new errors.ExistenceError();
    });
    assert.equal(a, undefined);
    const b = errors.ignoreExistenceError(() => 1);
    assert.equal(b, 1);

    let plan = 0;
    try {
      errors.ignoreExistenceError(() => {
        throw new Error("dont ignore me");
      });
    } catch (err) {
      assert.ok(err);
      plan++;
    }
    assert.equal(plan, 1);
  });
  test("ignoreExistenceErrorAsync", async function () {
    const a = await errors.ignoreExistenceErrorAsync(async () => {
      throw new errors.ExistenceError();
    });
    assert.equal(a, undefined);
    const b = await errors.ignoreExistenceErrorAsync(async () => 1);
    assert.equal(b, 1);

    const c = await errors.ignoreExistenceErrorAsync(() => 1);
    assert.equal(c, 1);

    let plan = 0;
    try {
      await errors.ignoreExistenceErrorAsync(async () => {
        throw new Error("dont ignore me");
      });
    } catch (err) {
      assert.ok(err);
      plan++;
    }
    assert.equal(plan, 1);
  });
});
