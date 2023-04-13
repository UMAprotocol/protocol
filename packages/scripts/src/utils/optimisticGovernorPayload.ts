import { Provider } from "@ethersproject/providers";
import { ERC20Ethers } from "@uma/contracts-node";
import { utils } from "ethers";
import { getContractInstanceWithProvider } from "./contracts";

interface ApprovalPayload {
  approvalTokenAddress: string;
  proposalPayload: string;
  explanation: string;
  approvalAmount: string;
  recipient: string;
}

// Helper function to generate the payload for an approval transaction to be proposed through the OptimisticGovernor.
// It is intended to be used on creating a sample proposal payload limited to a single approval transaction.
// This uses TOKEN, AMOUNT and RECIPIENT from environment variables, or falls back to the provided parameters.
export async function createApprovalPayload(
  provider: Provider,
  fallbackToken?: string,
  fallbackAmount?: string,
  fallbackRecipient?: string
): Promise<ApprovalPayload> {
  const approvalTokenAddress = process.env.TOKEN !== undefined ? process.env.TOKEN : fallbackToken;
  if (approvalTokenAddress === undefined) throw new Error("Must provide TOKEN");
  if (!utils.isAddress(approvalTokenAddress)) throw new Error("Invalid approval TOKEN address");
  const approvalToken = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, approvalTokenAddress);
  const symbol = await approvalToken.symbol();
  const decimals = await approvalToken.decimals();
  const approvalAmount = process.env.AMOUNT !== undefined ? process.env.AMOUNT : fallbackAmount;
  if (approvalAmount === undefined) throw new Error("Must provide AMOUNT");
  const recipient = process.env.RECIPIENT !== undefined ? process.env.RECIPIENT : fallbackRecipient;
  if (recipient === undefined) throw new Error("Must provide RECIPIENT");
  if (!utils.isAddress(recipient)) throw new Error("Invalid RECIPIENT address");
  const proposalPayload = approvalToken.interface.encodeFunctionData("approve", [
    recipient,
    utils.parseUnits(approvalAmount, decimals),
  ]);
  const explanation = `Approve ${approvalAmount} ${symbol} to ${recipient}`;
  return { approvalTokenAddress, proposalPayload, explanation, approvalAmount, recipient };
}
