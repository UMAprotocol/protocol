import assert from "assert";
import * as bridgePool from "./bridgePool";
import { BigNumber } from "ethers";

test("previewRemoval", function () {
  const user = {
    address: "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D",
    lpTokens: "900000000000000000",
    positionValue: "900000541941830509",
    totalDeposited: "900000000000000000",
    feesEarned: "541941830509",
  };
  const result = bridgePool.previewRemoval(user.positionValue, user.feesEarned, 0.75);
  assert.equal(BigNumber.from(result.position.recieve).add(result.position.remain), user.positionValue);
  assert.equal(BigNumber.from(result.fees.recieve).add(result.fees.remain), user.feesEarned);
});
test("calculateApy", function () {
  const pool = {
    address: "0xf42bB7EC88d065dF48D60cb672B88F8330f9f764",
    totalPoolSize: "13900116882750652331",
    l1Token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    exchangeRateCurrent: "1000000666720227009",
    exchangeRatePrevious: "1000000666644862062",
  };
  const result = bridgePool.calculateApy(pool.exchangeRateCurrent, pool.exchangeRatePrevious);
  assert.ok(result);
});
test("calculateApy2", function () {
  const pool = {
    address: "0xf42bB7EC88d065dF48D60cb672B88F8330f9f764",
    totalPoolSize: "13900116882750652331",
    l1Token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    exchangeRateCurrent: "1000100000000000000",
    exchangeRatePrevious: "1000000000000000000",
  };
  const result = bridgePool.calculateApy(pool.exchangeRateCurrent, pool.exchangeRatePrevious);
  assert.ok(result);
});
