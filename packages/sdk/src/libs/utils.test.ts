import * as utils from "./utils";
import assert from "assert";
test("ConvertDecimals", function () {
  let convert = utils.ConvertDecimals(18, 18);
  let num = "1000";
  let result = convert(num);
  assert.equal(result, num);

  convert = utils.ConvertDecimals(18, 8);
  num = "1000000000000000000";
  result = convert(num);
  assert.equal(result, "100000000");

  convert = utils.ConvertDecimals(8, 18);
  num = "1";
  result = convert(num);
  assert.equal(result, "10000000000");
});
test("Balances", function () {
  const balances = utils.Balances();
  assert.ok(balances);
  balances.create("a", "100");
  balances.create("b", "99");
  let result = balances.get("a");
  assert.equal(result, "100");
  result = balances.get("b");
  assert.equal(result, "99");

  result = balances.sub("a", 1);
  assert.equal(result, "99");

  result = balances.sub("b", 1);
  assert.equal(result, "98");

  result = balances.add("b", 2);
  assert.equal(result, "100");

  const bals = balances.balances;
  assert.equal(Object.keys(bals).length, 2);
});
