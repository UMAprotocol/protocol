const { getAbi, getAddress } = require("@uma/contracts-node");
import { Contract } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";

export const getContractInstanceWithProvider = async <T extends Contract>(
  contractName: string,
  provider: Provider,
  address?: string
): Promise<T> => {
  const networkId = (await provider.getNetwork()).chainId;
  const contractAddress = address || (await getAddress(contractName, networkId));
  const contractAbi = getAbi(contractName);
  return new Contract(contractAddress, contractAbi, provider) as T;
};
