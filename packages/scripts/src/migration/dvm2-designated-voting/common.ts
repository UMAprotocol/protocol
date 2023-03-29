import fetch from "node-fetch";

import { VotingTokenEthers, DesignatedVotingFactoryEthers, DesignatedVotingEthers } from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";
import { BigNumber } from "ethers";

interface EtherscanTransactionListResponse {
  input: string;
  from: string;
  functionName: string;
}

export interface DesignatedVotingOwnerWithBalance {
  designatedVoting: string;
  owner: string;
  voter: string;
  balance: BigNumber;
}

export async function getDesignatedVotingContractsOwnedByOwner(
  owner: string
): Promise<DesignatedVotingOwnerWithBalance[]> {
  const factoryV1 = await getContractInstance<DesignatedVotingFactoryEthers>("DesignatedVotingFactory");

  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  // Step 1: find all DesignatedVoting contracts created by the DesignatedVotingFactory.
  const designatedVotingContracts = await _fetchDesignatedVotingContractsCreatedByFactory(factoryV1);

  // Step 3: return all DesignatedVoting contracts with the contract, owner, hot wallet and balance for each.
  return (
    await Promise.all(
      designatedVotingContracts.map(async (DesignatedVotingAddress) => {
        const contract = await getContractInstance<DesignatedVotingEthers>("DesignatedVoting", DesignatedVotingAddress);
        const contractOwner = await contract.getMember(0);
        const voter = await contract.getMember(1);
        const balance = await votingToken.balanceOf(contract.address);
        // Typescript knows these values are all defined.
        return { designatedVoting: contract.address, owner: contractOwner, voter, balance };
      })
    )
  ).filter((contract) => contract.owner === owner);
}

async function _fetchDesignatedVotingContractsCreatedByFactory(
  factoryV1: DesignatedVotingFactoryEthers
): Promise<string[]> {
  const data = await _runEtherscanApiCall(
    `https://api.etherscan.io/api?module=account&action=txlist&address=${factoryV1.address}&startblock=0&endblock=99999999&sort=asc`
  );

  const createCallers = data
    .filter((tx) => tx.functionName.includes("newDesignatedVoting")) // choose only newDesignatedVoting calls.
    .map((tx) => tx.from as string); // extract the caller address.

  const designatedVotingFromCreation = await Promise.all(
    createCallers.map((creator: string) => factoryV1.designatedVotingContracts(creator))
  );

  const setDesignatedVotingInputs = data
    .filter((tx) => tx.functionName.includes("setDesignatedVoting")) // choose only setDesignatedVoting calls.
    .map((tx) => tx.input as string); // extract the input calldata.

  // Now, extract the target designated voting contract from the input calldata.
  const designatedVotingFromSetDesignatedVoting = setDesignatedVotingInputs.map(
    (input: string) => "0x" + input.substring(input.length - 40, input.length)
  );

  // Merge the two sets and return the unique set of designated voting contracts.
  return [...new Set([...designatedVotingFromCreation, ...designatedVotingFromSetDesignatedVoting])].filter(
    (address) => address != "0x0000000000000000000000000000000000000000"
  );
}

async function _runEtherscanApiCall(url: string): Promise<EtherscanTransactionListResponse[]> {
  if (!process.env.ETHERSCAN_API_KEY) throw new Error("No ETHERSCAN_API_KEY");
  const response = await fetch(`${url}&apikey=${process.env.ETHERSCAN_API_KEY}}`, {
    method: "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  });
  return (await response.json()).result;
}
