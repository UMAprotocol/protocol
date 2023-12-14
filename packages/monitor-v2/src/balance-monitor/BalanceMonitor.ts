import { Provider } from "@ethersproject/abstract-provider";
import { createEtherscanLinkMarkdown, createFormatFunction, PublicNetworks } from "@uma/common";
import { ERC20Ethers } from "@uma/contracts-node";
import { AugmentedLogger } from "@uma/financial-templates-lib";
import { BigNumber, utils } from "ethers";

import { getContractInstanceWithProvider, getCurrencyDecimals, getCurrencySymbol } from "../utils/contracts";

export interface MonitoredToken {
  address?: string; // If not provided, this is monitoring native token.
  warnThreshold?: number; // Human readable balance threshold to trigger a warning.
  errorThreshold?: number; // Human readable balance threshold to trigger an error.
}

export interface MonitoredAccount {
  chainId: number;
  address: string;
  name?: string; // If not provided, address is used as name.
  tokens: MonitoredToken[];
}

// Internal interface to hold monitored item in the BalanceMonitor.
interface MonitoredBalance {
  accountName: string;
  accountAddress: string;
  provider: Provider;
  chainId: number;
  networkName: string;
  tokenSymbol: string;
  tokenAddress?: string; // If not provided, this is monitoring native token.
  tokenDecimals: number;
  warnThreshold: BigNumber; // Raw balance threshold to trigger a warning.
  errorThreshold: BigNumber; // Raw balance threshold to trigger an error.
}

function isMonitoredToken(obj: unknown): obj is MonitoredToken {
  if (typeof obj !== "object" || obj === null) return false;
  const token = obj as MonitoredToken;

  const hasValidAddress =
    token.address === undefined || (typeof token.address === "string" && utils.isAddress(token.address));
  const hasValidWarnThreshold = token.warnThreshold === undefined || typeof token.warnThreshold === "number";
  const hasValidErrorThreshold = token.errorThreshold === undefined || typeof token.errorThreshold === "number";

  return hasValidAddress && hasValidWarnThreshold && hasValidErrorThreshold;
}

function isMonitoredAccount(obj: unknown): obj is MonitoredAccount {
  if (typeof obj !== "object" || obj === null) return false;
  const account = obj as MonitoredAccount;

  const hasValidChainId = typeof account.chainId === "number";
  const hasValidAddress = typeof account.address === "string" && utils.isAddress(account.address);
  const hasValidName = account.name === undefined || typeof account.name === "string";
  const hasValidTokens = Array.isArray(account.tokens) && account.tokens.every(isMonitoredToken);

  return hasValidChainId && hasValidAddress && hasValidName && hasValidTokens;
}

export function isMonitoredAccountsArray(obj: unknown): obj is MonitoredAccount[] {
  if (!Array.isArray(obj)) return false;
  return obj.every(isMonitoredAccount);
}

export class BalanceMonitor {
  private constructor(private readonly monitoredBalances: MonitoredBalance[]) {}

  // Internal method to get raw threshold from human readable amount.
  private static parseThreshold(threshold: number | undefined, decimals: number): BigNumber {
    if (threshold === undefined) return BigNumber.from(0);
    return utils.parseUnits(threshold.toString(), decimals);
  }

  static async create(
    providers: Map<number, Provider>,
    monitoredAccounts: MonitoredAccount[]
  ): Promise<BalanceMonitor> {
    // Will parallelize all async calls.
    const monitoredBalances = await Promise.all(
      monitoredAccounts
        .map((account) => {
          const provider = providers.get(account.chainId);
          if (!provider) throw new Error(`No provider for chainId ${account.chainId}`);

          return account.tokens.map(async (token) => {
            const tokenSymbolPromise = token.address
              ? getCurrencySymbol(provider, token.address)
              : PublicNetworks[account.chainId]?.nativeToken || "UNKNOWN";
            const tokenDecimalsPromise = token.address ? getCurrencyDecimals(provider, token.address) : 18;

            const [tokenSymbol, tokenDecimals] = await Promise.all([tokenSymbolPromise, tokenDecimalsPromise]);

            return {
              accountName: account.name || account.address,
              accountAddress: account.address,
              provider,
              chainId: account.chainId,
              networkName: PublicNetworks[account.chainId]?.name || "unknown",
              tokenSymbol,
              tokenAddress: token.address,
              tokenDecimals,
              warnThreshold: BalanceMonitor.parseThreshold(token.warnThreshold, tokenDecimals),
              errorThreshold: BalanceMonitor.parseThreshold(token.errorThreshold, tokenDecimals),
            };
          });
        })
        .flat() // Flattens since there will be nested arrays of promises.
    );

    return new BalanceMonitor(monitoredBalances);
  }

  private async getTokenBalance(monitoredBalance: MonitoredBalance, blockNumber?: number): Promise<BigNumber> {
    const tokenContract = await getContractInstanceWithProvider<ERC20Ethers>(
      "ERC20",
      monitoredBalance.provider,
      monitoredBalance.tokenAddress
    );
    return await tokenContract.balanceOf(monitoredBalance.accountAddress, { blockTag: blockNumber });
  }

  async checkBalances(logger: AugmentedLogger, blockNumber?: number): Promise<void> {
    // Check all balances in parallel.
    const checkBalancesPromises = this.monitoredBalances.map(async (monitoredBalance) => {
      const balance = monitoredBalance.tokenAddress
        ? await this.getTokenBalance(monitoredBalance, blockNumber) // ERC20 token.
        : await monitoredBalance.provider.getBalance(monitoredBalance.accountAddress, blockNumber); // Native token.

      let logLevel: "warn" | "error" | undefined;
      if (balance.lt(monitoredBalance.errorThreshold)) logLevel = "error";
      else if (balance.lt(monitoredBalance.warnThreshold)) logLevel = "warn";
      else return; // No need to log as balance is above all thresholds.

      logger[logLevel]({
        at: "BalanceMonitor",
        message: `Low ${monitoredBalance.tokenSymbol} balance for ${monitoredBalance.accountName} on ${monitoredBalance.networkName} 😱`,
        mrkdwn:
          createEtherscanLinkMarkdown(monitoredBalance.accountAddress, monitoredBalance.chainId) +
          " has left " +
          createFormatFunction(2, 2, false, monitoredBalance.tokenDecimals)(balance.toString()) +
          " " +
          monitoredBalance.tokenSymbol,
      });
    });

    await Promise.all(checkBalancesPromises);
  }
}
