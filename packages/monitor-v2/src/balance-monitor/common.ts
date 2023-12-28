import { Provider } from "@ethersproject/abstract-provider";
import { getRetryProvider } from "@uma/common";

import { BalanceMonitor, isMonitoredAccountsArray } from "./BalanceMonitor";

export interface MonitoringParams {
  pollingDelay: number;
  balanceMonitor: BalanceMonitor;
}

export async function initMonitoringParams(env: NodeJS.ProcessEnv): Promise<MonitoringParams> {
  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  let monitoredAccounts;
  try {
    monitoredAccounts = env.MONITORED_ACCOUNTS ? JSON.parse(env.MONITORED_ACCOUNTS) : undefined;
    if (!isMonitoredAccountsArray(monitoredAccounts)) throw new Error();
  } catch (error) {
    throw new Error("MONITORED_ACCOUNTS must be a valid JSON array of MonitoredAccount objects");
  }

  // Create a provider for each chainId.
  const providers = new Map<number, Provider>();
  for (const account of monitoredAccounts) {
    if (!providers.has(account.chainId)) {
      providers.set(account.chainId, getRetryProvider(account.chainId));
    }
  }

  const balanceMonitor = await BalanceMonitor.create(providers, monitoredAccounts);

  return { pollingDelay, balanceMonitor };
}
