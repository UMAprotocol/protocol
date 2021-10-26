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
