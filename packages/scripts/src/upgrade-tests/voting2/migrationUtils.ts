const hre = require("hardhat");
import { getAddress } from "@uma/contracts-node";

export const NEW_CONTRACTS = {
  governor: "GOVERNOR_V2_ADDRESS",
  proposer: "PROPOSER_V2_ADDRESS",
  voting: "VOTING_V2_ADDRESS",
};

export const OLD_CONTRACTS = {
  governor: "GOVERNOR_ADDRESS",
  proposer: "PROPOSER_ADDRESS",
  voting: "VOTING_ADDRESS",
};

export const VOTING_UPGRADER_ADDRESS = "VOTING_UPGRADER_ADDRESS";

export const TEST_MODE = "TEST_MODE";

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
  };
};

export const getMultiRoleContracts = async (networkId: number): Promise<{ registry: string; store: string }> => {
  return {
    registry: await getAddress("Registry", networkId),
    store: await getAddress("Store", networkId),
  };
};

export const checkEnvVariables = (): void => {
  // mandatory variables
  Object.values(NEW_CONTRACTS).forEach((element) => {
    if (!process.env[element]) throw new Error(`${element} not set`);
  });

  // optional variables
  // if any of these are set, then all of them must be set
  if (Object.values(OLD_CONTRACTS).find((element) => process.env[element])) {
    Object.values(OLD_CONTRACTS).forEach((element) => {
      if (!process.env[element]) throw new Error(`${element} not set`);
    });
  }
};

export const isContractInstance = async (address: string, functionSignature: string): Promise<boolean> => {
  const code = await hre.ethers.provider.getCode(address);
  const encodedSignature = hre.web3.eth.abi.encodeFunctionSignature(functionSignature).slice(2);
  return code.includes(encodedSignature);
};
