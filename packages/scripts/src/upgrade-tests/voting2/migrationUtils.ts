import { getAddress } from "@uma/contracts-node";

export const getOwnableContracts = async (
  networkId: number
): Promise<{
  identifierWhitelist: string;
  financialContractsAdmin: string;
  addressWhitelist: string;
  governorRootTunnel: string;
  arbitrumParentMessenger: string;
  oracleHub: string;
  governorHub: string;
  bobaParentMessenger: string;
  optimismParentMessenger: string;
  proposer: string;
}> => {
  return {
    identifierWhitelist: await getAddress("IdentifierWhitelist", networkId),
    financialContractsAdmin: await getAddress("FinancialContractsAdmin", networkId),
    addressWhitelist: await getAddress("AddressWhitelist", networkId),
    governorRootTunnel: await getAddress("GovernorRootTunnel", networkId),
    arbitrumParentMessenger: await getAddress("Arbitrum_ParentMessenger", networkId),
    oracleHub: await getAddress("OracleHub", networkId),
    governorHub: await getAddress("GovernorHub", networkId),
    bobaParentMessenger: await getAddress("Boba_ParentMessenger", networkId),
    optimismParentMessenger: await getAddress("Optimism_ParentMessenger", networkId),
    proposer: await getAddress("Proposer", networkId),
  };
};

export const getMultiRoleContracts = async (networkId: number): Promise<{ registry: string; store: string }> => {
  return {
    registry: await getAddress("Registry", networkId),
    store: await getAddress("Store", networkId),
  };
};
