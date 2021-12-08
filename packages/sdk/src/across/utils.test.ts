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
});
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
test("percent", async function () {
  let percent = utils.percent(1, 10);
  assert.equal(utils.fromWei(percent), "0.1");
  percent = utils.percent(5, 88);
  assert.equal(utils.fromWei(percent), "0.056818181818181818");
});
test("calcContinuousCompoundInterest", function () {
  const startPrice = "1";
  const endPrice = "2";
  const periodsElapsed = "365";
  const periodsPerYear = "365";
  const result = utils.calcContinuousCompoundInterest(startPrice, endPrice, periodsElapsed, periodsPerYear);
  // https://www.calculatorsoup.com/calculators/financial/compound-interest-calculator.php?given_data=find_r&A=2.00&P=1.00&n=0&t=1&given_data_last=find_r&action=solve
  assert.equal((Number(result) * 100).toFixed(3), "69.315");
});
test("calcPeriodicCompoundInterest", function () {
  const startPrice = "1";
  const endPrice = "2";
  const periodsElapsed = "365";
  const periodsPerYear = "365";
  const result = utils.calcPeriodicCompoundInterest(startPrice, endPrice, periodsElapsed, periodsPerYear);
  // https://www.calculatorsoup.com/calculators/financial/compound-interest-calculator.php?given_data=find_r&A=2.00&P=1.00&n=365&t=1&given_data_last=find_r&action=solve
  assert.equal((Number(result) * 100).toFixed(3), "69.381");
});
test("calcApr", function () {
  const startPrice = "1";
  const endPrice = "2";
  const periodsElapsed = "365";
  const periodsPerYear = "365";
  const result = utils.calcApr(startPrice, endPrice, periodsElapsed, periodsPerYear);
  assert.equal(Number(result), 1);
});
