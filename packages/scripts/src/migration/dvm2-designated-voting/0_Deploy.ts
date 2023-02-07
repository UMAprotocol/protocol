const hre = require("hardhat");
const fetch = require("node-fetch");

import {
  VotingTokenEthers,
  DesignatedVotingFactoryEthers,
  DesignatedVotingEthers,
  // DesignatedVotingV2FactoryEthers,
} from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";

async function main() {
  console.log("Running DesignatedVotingV2 deployments🔥");

  const networkId = Number(await hre.getChainId());
  if (networkId != 1) throw new Error("Can only run on mainnet");
  if (!process.env.ETHERSCAN_API_KEY) throw new Error("No ETHERSCAN_API_KEY");
  if (!process.env.OWNER_TO_MIGRATE) throw new Error("No OWNER_TO_MIGRATE set");
  const owner = process.env.OWNER_TO_MIGRATE || "";

  const factoryV1 = await getContractInstance<DesignatedVotingFactoryEthers>("DesignatedVotingFactory");
  // const factoryV2 = await getContractInstance<DesignatedVotingV2FactoryEthers>("DesignatedVotingV2Factory");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  // Step 1: find all DesignatedVoting contracts created by the DesignatedVotingFactory.
  const designatedVotingContracts = await _fetchDesignatedVotingContractsCreatedByFactory(factoryV1);

  // Step 2: remove all DesignatedVoting contracts that have 0 UMA.
  const contractsTokenBalances = await Promise.all(
    designatedVotingContracts.map(async (address) => votingToken.balanceOf(address))
  );
  const designatedVotingContractsWithTokens: DesignatedVotingEthers[] = [];
  for (let i = 0; i < designatedVotingContracts.length; i++)
    if (contractsTokenBalances[i].gt(0))
      designatedVotingContractsWithTokens.push(
        await getContractInstance<DesignatedVotingEthers>("DesignatedVoting", designatedVotingContracts[i])
      );

  // Step 3: Find all owners and hot wallets for all DesignatedVoting contracts that have UMA. Construct one condensed
  // data structure that contains all key information. Remove any that are not owned by the provided owner.

  const designatedVotingData = (
    await Promise.all(
      designatedVotingContractsWithTokens.map(async (contract) => {
        const contractOwner = await contract.getMember(0);
        const hotWallet = await contract.getMember(1);
        // Typescript knows these values are all defined.
        return { designatedVoting: contract.address, owner: contractOwner, hotWallet };
      })
    )
  ).filter((contract) => contract.owner === owner);

  // Log all designated voting and the associated hot wallets. remove the owner element from the object to keep it short.
  console.log(`Found the following DesignatedVoting to migrate owned by ${owner}:`);
  console.table(
    designatedVotingData.map((e: { designatedVoting: string; owner?: string; hotWallet: string }) => {
      delete e.owner;
      return e;
    })
  );

  // Step 4: Deploy new DesignatedVotingV2 contracts for each hot wallet.
  // const multiCallPayload = designatedVotingData.map(async (data) => {
  //   await factoryV2.populateTransaction.newDesignatedVoting(owner, data.hotWallet);
  // });

  // console.log("multiCallPayload", multiCallPayload);
}

interface EtherscanTransactionListResponse {
  input: string;
  from: string;
  functionName: string;
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
  return [...new Set([...designatedVotingFromCreation, ...designatedVotingFromSetDesignatedVoting])];
}

async function _runEtherscanApiCall(url: string): Promise<EtherscanTransactionListResponse[]> {
  const response = await fetch(`${url}&apikey=${process.env.ETHERSCAN_API_KEY}}`, {
    method: "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  });
  return (await response.json()).result;
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
