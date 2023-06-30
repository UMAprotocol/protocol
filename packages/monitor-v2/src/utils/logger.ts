const optimisticOracleV2UIBaseUrl = "https://oracle.uma.xyz";
const testnetOptimisticOracleV2UIBaseUrl = "https://testnet.oracle.uma.xyz";

// monitor-v2 package is only using Optimistic Oracle V3, so currently there is no need to generalize this.
export const generateOOv3UILink = (transactionHash: string, eventIndex: number, chainId?: number): string => {
  // Currently testnet UI supports only goerli, so assume any other chain is production.
  const baseUrl = chainId === 5 ? testnetOptimisticOracleV2UIBaseUrl : optimisticOracleV2UIBaseUrl;
  return `<${baseUrl}/?transactionHash=${transactionHash}&eventIndex=${eventIndex}|View in UI>`;
};

export const createSnapshotProposalLink = (baseUrl: string, space: string, proposalId: string): string => {
  return `<${baseUrl}/#/${space}/proposal/${proposalId}|Snapshot UI>`;
};
