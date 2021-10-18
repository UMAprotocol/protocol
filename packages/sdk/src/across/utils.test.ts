import assert from "assert";
import * as across from ".";
const { constants, utils } = across;

const estimatedGasPrice = 63172642034; // 63 gwei

test("ethToToken", function () {
  const result = utils.ethToToken(1000, 0.1);
  assert.equal(result.toString(), "10000");
});
test("estimateSlowEth", async function () {
  const gas = constants.SLOW_ETH_GAS;
  const gasPrice = estimatedGasPrice;
  const result = utils.calculateGasFees(gas, gasPrice);
  const userDisplay = utils.fromWei(result);
  assert.ok(userDisplay);
});
test("estimateFastEth", async function () {
  const gas = constants.FAST_ETH_GAS;
  const gasPrice = estimatedGasPrice;
  const result = utils.calculateGasFees(gas, gasPrice);
  const userDisplay = utils.fromWei(result);
  assert.ok(userDisplay);
});
test("estimate usdc slow", async function () {
  const gas = constants.SLOW_ERC_GAS;
  const gasPrice = estimatedGasPrice;
  // denominate price in eth
  const tokenPrice = 0.00026431;
  const decimals = 6;
  const result = utils.calculateGasFees(gas, gasPrice, tokenPrice, decimals);
  const userDisplay = utils.fromWei(result, decimals);
  assert.ok(userDisplay);
}, 10000);
test("estimate uma slow", async function () {
  const gas = constants.SLOW_UMA_GAS;
  const gasPrice = estimatedGasPrice;
  // denominate price in eth
  const tokenPrice = 0.00274888;
  // uma uses 18 decimals, so omitting it defaults to 18
  const result = utils.calculateGasFees(gas, gasPrice, tokenPrice);
  const userDisplay = utils.fromWei(result);
  assert.ok(userDisplay);
});
