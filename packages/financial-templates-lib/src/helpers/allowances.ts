import { MAX_SAFE_ALLOWANCE, MAX_UINT_VAL, runTransaction } from "@uma/common";
import { getAbi } from "@uma/contracts-node";
import { ExpandedERC20Web3 } from "@uma/contracts-node";
import type Web3 from "web3";
import type { TransactionReceipt } from "web3-core";
import type { GasEstimator } from "./GasEstimator";

type ContractSendMethod = Parameters<typeof runTransaction>[0]["transaction"];

// Sets `owner` allowance for `spender` to MAX_UINT_VAL, unless `spender` already has an allowance > MAX_SAFE_ALLOWANCE.
// Return successful approval transaction data, or undefined for skipped approvals.
export const setAllowance = async (
  web3: Web3,
  gasEstimator: GasEstimator,
  ownerAddress: string,
  spenderAddress: string,
  currencyAddress: string
): Promise<
  | {
      tx: TransactionReceipt;
      spenderAddress: string;
      currencyAddress: string;
    }
  | undefined
> => {
  const { toBN } = web3.utils;
  const collateralToken = (new web3.eth.Contract(
    getAbi("ExpandedERC20"),
    currencyAddress
  ) as unknown) as ExpandedERC20Web3;
  const currentCollateralAllowance = await collateralToken.methods.allowance(ownerAddress, spenderAddress).call();
  if (toBN(currentCollateralAllowance).lt(toBN(MAX_SAFE_ALLOWANCE))) {
    const approveTransaction = collateralToken.methods.approve(spenderAddress, MAX_UINT_VAL);
    const { receipt } = await runTransaction({
      web3,
      transaction: (approveTransaction as unknown) as ContractSendMethod,
      transactionConfig: { ...gasEstimator.getCurrentFastPrice(), from: ownerAddress },
    });
    return { tx: receipt as TransactionReceipt, spenderAddress, currencyAddress };
  }
};
