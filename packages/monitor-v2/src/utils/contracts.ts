import { ContractName, ERC20Ethers, getAbi, getAddress } from "@uma/contracts-node";
import { Contract } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";
import { utils } from "ethers";

export const sameAddress = (address1: string, address2: string): boolean =>
  address1.toLowerCase() === address2.toLowerCase();

export const getContractInstanceWithProvider = async <T extends Contract>(
  contractName: ContractName,
  provider: Provider,
  address?: string
): Promise<T> => {
  const networkId = (await provider.getNetwork()).chainId;
  const contractAddress = address || (await getAddress(contractName, networkId));
  const contractAbi = getAbi(contractName);
  return new Contract(contractAddress, contractAbi, provider) as T;
};

export const tryHexToUtf8String = (ancillaryData: string): string => {
  try {
    return utils.toUtf8String(ancillaryData);
  } catch (err) {
    return ancillaryData;
  }
};

export const getCurrencyDecimals = async (provider: Provider, currencyAddress: string): Promise<number> => {
  const currencyContract = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, currencyAddress);
  try {
    return await currencyContract.decimals();
  } catch (err) {
    return 18;
  }
};

export const getCurrencySymbol = async (provider: Provider, currencyAddress: string): Promise<string> => {
  const currencyContract = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, currencyAddress);
  try {
    return await currencyContract.symbol();
  } catch (err) {
    // Try to get the symbol as bytes32 (e.g. MKR uses this).
    try {
      const bytes32SymbolIface = new utils.Interface(["function symbol() view returns (bytes32 symbol)"]);
      const bytes32Symbol = await provider.call({
        to: currencyAddress,
        data: bytes32SymbolIface.encodeFunctionData("symbol"),
      });
      return utils.parseBytes32String(bytes32SymbolIface.decodeFunctionResult("symbol", bytes32Symbol).symbol);
    } catch (err) {
      return "";
    }
  }
};

// Gets the topic of an event from its name. In case of overloaded events, the first one found is returned.
export const getEventTopic = (contractName: ContractName, eventName: string): string => {
  const contractAbi = getAbi(contractName);
  const iface = new utils.Interface(contractAbi);
  const eventKey = Object.keys(iface.events).find((key) => iface.events[key].name === eventName);
  if (!eventKey) throw new Error(`Event ${eventName} not found in contract ${contractName}`);
  return utils.keccak256(utils.toUtf8Bytes(eventKey));
};
