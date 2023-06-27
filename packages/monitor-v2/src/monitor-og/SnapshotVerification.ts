import { TransactionsProposedEvent } from "@uma/contracts-node/typechain/core/ethers/OptimisticGovernor";
import assert from "assert";
import retry from "async-retry";
import { Options as RetryOptions } from "async-retry";
import fetch from "node-fetch";
import { request } from "graphql-request";
import { gql } from "graphql-tag";

import { ethersUtils, MonitoringParams, tryHexToUtf8String } from "./common";

// If there are multiple transactions within a batch, they are aggregated as multiSend in the mainTransaction.
interface MainTransaction {
  to: string;
  data: string;
  value: string;
  operation: string;
}

// We only include properties that will be verified by the bot.
interface SafeSnapSafe {
  txs: { mainTransaction: MainTransaction }[];
  network: string;
  umaAddress: string;
}

interface SafeSnapPlugin {
  safeSnap: { safes: SafeSnapSafe[] };
}

// We only type the properties required in the verification. IPFS hosted proposal object includes additional properties
// that we don't look at.
interface SnapshotProposalIpfs {
  space: string;
  type: string;
  choices: string[];
  start: number;
  end: number;
  plugins: Partial<SafeSnapPlugin>;
}

// We only type the properties requested in the GraphQL queries. This extends SnapshotProposalIpfs, but we need to
// override the space property.
export interface SnapshotProposalGraphql extends Omit<SnapshotProposalIpfs, "space"> {
  ipfs: string;
  state: string;
  space: { id: string };
  scores: number[];
  quorum: number;
  scores_total: number;
}

export interface GraphqlData {
  proposals: SnapshotProposalGraphql[];
}

interface IpfsData {
  data: {
    message: SnapshotProposalIpfs;
  };
}

export type VerificationResponse = { verified: true } | { verified: false; error: string };

export interface RulesParameters {
  space: string;
  quorum: number;
  votingPeriod: number;
}

// Returns null if the rules string does not match the expected template.
export const parseRules = (rules: string): RulesParameters | null => {
  // This is based on the template from Zodiac app at
  // https://github.com/gnosis/zodiac-safe-app/blob/79dbb72af506f60fcc16599516ce48f893393b29/packages/app/src/views/AddModule/wizards/OptimisticGovernorModule/OptimisticGovernorModuleModal.tsx#L136
  const regex = /^I assert that this transaction proposal is valid according to the following rules: Proposals approved on Snapshot, as verified at https:\/\/snapshot\.org\/#\/([a-zA-Z0-9-.]+), are valid as long as there is a minimum quorum of (\d+) and a minimum voting period of (\d+) hours and it does not appear that the Snapshot voting system is being exploited or is otherwise unavailable\. The quorum and voting period are minimum requirements for a proposal to be valid\. Quorum and voting period values set for a specific proposal in Snapshot should be used if they are more strict than the rules parameter\. The explanation included with the on-chain proposal must be the unique IPFS identifier for the specific Snapshot proposal that was approved or a unique identifier for a proposal in an alternative voting system approved by DAO social consensus if Snapshot is being exploited or is otherwise unavailable.$/;

  const match = rules.match(regex);
  if (!match) {
    return null;
  }

  const space = match[1];
  const quorum = parseInt(match[2]);
  const votingPeriod = parseInt(match[3]);

  return { space, quorum, votingPeriod };
};

// We don't want to throw an error if the GraphQL request fails for any reason, so we return a stringified Error object
// instead that will be logged by the bot.
const getGraphqlData = async (
  ipfsHash: string,
  url: string,
  retryOptions: RetryOptions
): Promise<GraphqlData | Error> => {
  const query = gql(/* GraphQL */ `
    query GetProposals($ipfsHash: String) {
      proposals(first: 2, where: { ipfs: $ipfsHash }, orderBy: "created", orderDirection: desc) {
        ipfs
        type
        choices
        start
        end
        state
        space {
          id
        }
        scores
        quorum
        scores_total
        plugins
      }
    }
  `);
  return retry(
    () => request<GraphqlData, { ipfsHash: string }>(url, query, { ipfsHash }),
    retryOptions
  ).catch((error) => {
    assert(error instanceof Error, "Unexpected Error type!");
    return error;
  });
};

// We don't want to throw an error if the IPFS request fails for any reason, so we return a stringified Error object
// instead that will be logged by the bot.
const getIpfsData = async (ipfsHash: string, url: string, retryOptions: RetryOptions): Promise<IpfsData | Error> => {
  try {
    const response = await retry(async () => {
      const fetchResponse = await fetch(`${url}/${ipfsHash}`);
      if (!fetchResponse.ok) {
        throw new Error(`Request on ${fetchResponse.url} failed with status ${fetchResponse.status}`);
      }
      return fetchResponse;
    }, retryOptions);

    const data = await response.json();

    // Try to parse the plugins property as JSON.
    data.data.message.plugins = JSON.parse(data.data.message.plugins);
    return data;
  } catch (error) {
    assert(error instanceof Error, "Unexpected Error type!");
    return error;
  }
};

const ipfsMatchGraphql = (ipfsData: IpfsData, graphqlData: GraphqlData): boolean => {
  const ipfsProposal = ipfsData.data.message;
  const graphqlProposal = graphqlData.proposals[0];

  // Verify common properties, except for safeSnap plugin.
  if (
    ipfsProposal.space !== graphqlProposal.space.id ||
    ipfsProposal.type !== graphqlProposal.type ||
    JSON.stringify(ipfsProposal.choices) !== JSON.stringify(graphqlProposal.choices) ||
    ipfsProposal.start !== graphqlProposal.start ||
    ipfsProposal.end !== graphqlProposal.end
  ) {
    return false;
  }

  // Verify that the safeSnap plugin exists on both data sources and has the same number of safes.
  if (
    ipfsProposal.plugins.safeSnap === undefined ||
    graphqlProposal.plugins.safeSnap === undefined ||
    ipfsProposal.plugins.safeSnap.safes.length !== graphqlProposal.plugins.safeSnap.safes.length
  ) {
    return false;
  }

  // Verify that the safes match. We inspect only the properties that are required for verification.
  for (let i = 0; i < ipfsProposal.plugins.safeSnap.safes.length; i++) {
    const ipfsSafe = ipfsProposal.plugins.safeSnap.safes[i];
    const graphqlSafe = graphqlProposal.plugins.safeSnap.safes[i];

    // Verify the network, oSnap address and number of transaction batches.
    if (
      ipfsSafe.network !== graphqlSafe.network ||
      ipfsSafe.umaAddress !== graphqlSafe.umaAddress ||
      ipfsSafe.txs.length !== graphqlSafe.txs.length
    ) {
      return false;
    }

    // Verify that the transaction batch properties match.
    for (let j = 0; j < ipfsSafe.txs.length; j++) {
      const ipfsTransaction = ipfsSafe.txs[j].mainTransaction;
      const graphqlTransaction = graphqlSafe.txs[j].mainTransaction;

      if (
        ipfsTransaction.to !== graphqlTransaction.to ||
        ipfsTransaction.data !== graphqlTransaction.data ||
        ipfsTransaction.value !== graphqlTransaction.value ||
        ipfsTransaction.operation !== graphqlTransaction.operation
      ) {
        return false;
      }
    }
  }

  return true;
};

const isMatchingSafe = (safe: SafeSnapSafe, chainId: number, ogAddress: string): boolean => {
  return (
    safe.network === chainId.toString() && ethersUtils.getAddress(safe.umaAddress) === ethersUtils.getAddress(ogAddress)
  );
};

export const verifyProposal = async (
  transaction: TransactionsProposedEvent,
  params: MonitoringParams
): Promise<VerificationResponse> => {
  const ipfsHash = tryHexToUtf8String(transaction.args.explanation);
  // tryHexToUtf8String returns the input if it is not decoding to UTF-8 string.
  if (ipfsHash === transaction.args.explanation) {
    return { verified: false, error: `Could not decode explanation ${transaction.args.explanation}` };
  }

  // Get proposal data from GraphQL.
  const graphqlData = await getGraphqlData(ipfsHash, params.graphqlEndpoint, params.retryOptions);
  if (graphqlData instanceof Error) {
    return { verified: false, error: `GraphQL request failed with error ${graphqlData.message}` };
  }

  // Verify that the proposal exists and is unique.
  if (graphqlData.proposals.length === 0) {
    return { verified: false, error: `No proposal found for IPFS hash ${ipfsHash}` };
  } else if (graphqlData.proposals.length > 1) {
    return { verified: false, error: `Duplicate proposals found for IPFS hash ${ipfsHash}` };
  }

  // Verify proposal type.
  const proposal = graphqlData.proposals[0];
  if (proposal.type !== "single-choice" && proposal.type !== "basic") {
    return { verified: false, error: `Proposal type ${proposal.type} is not supported` };
  }

  // Verify that the basic proposal has expected choices or the single-choice proposal has exactly one approval choice.
  let approvalIndex: number;
  if (proposal.type === "basic") {
    // Assert that the basic proposal has expected choices. We error immediately as this indicates a problem with the
    // Snapshot backend.
    assert(proposal.choices.length === 3, "Basic proposal must have three choices");
    assert(proposal.choices[0] === "For", "Basic proposal must have 'For' as the first choice");
    assert(proposal.choices[1] === "Against", "Basic proposal must have 'Against' as the second choice");
    assert(proposal.choices[2] === "Abstain", "Basic proposal must have 'Abstain' as the third choice");
    approvalIndex = 0; // For is the first choice.
  } else {
    // Try to find the approval choice among the single choice proposal choices. Make sure there is one and only one
    // matching approval choice.
    approvalIndex = proposal.choices.findIndex((choice) =>
      params.approvalChoices.map((approvalChoice) => approvalChoice.toLowerCase()).includes(choice.toLowerCase())
    );
    if (approvalIndex === -1) {
      return { verified: false, error: `No known approval choice found among ${JSON.stringify(proposal.choices)}` };
    }
    const matchingChoices = proposal.choices.filter((choice) =>
      params.approvalChoices.map((approvalChoice) => approvalChoice.toLowerCase()).includes(choice.toLowerCase())
    );
    if (matchingChoices.length > 1) {
      return {
        verified: false,
        error: `Multiple approval choices found among ${JSON.stringify(proposal.choices)}`,
      };
    }
  }

  // Verify that the proposal is in the closed state.
  if (proposal.state !== "closed") {
    return { verified: false, error: "Proposal not in closed state" };
  }

  // Verify that the proposal voting period has ended.
  if (transaction.args.proposalTime.toNumber() < proposal.end) {
    return { verified: false, error: "Proposal voting period has not ended" };
  }

  // Verify quorum.
  if (proposal.scores_total !== null && proposal.scores_total < proposal.quorum) {
    return { verified: false, error: `Proposal did not meet Snapshot quorum of ${proposal.quorum}` };
  }

  // Verify proposal scores.
  if (proposal.scores === null || proposal.scores.length !== proposal.choices.length) {
    return { verified: false, error: "Proposal scores are not valid" };
  }

  // Verify that the proposal was approved by majority and got more than 50% of the votes.
  if (approvalIndex !== proposal.scores.indexOf(Math.max(...proposal.scores))) {
    return { verified: false, error: "Proposal was not approved by majority" };
  }
  if (proposal.scores_total !== null && proposal.scores[approvalIndex] <= proposal.scores_total / 2) {
    return { verified: false, error: "Proposal did not get more than 50% votes" };
  }

  // Verify that the proposal has a safeSnap plugin.
  if (proposal.plugins.safeSnap === undefined) {
    return { verified: false, error: "No safeSnap plugin found" };
  }

  // There must be one and only one matching safe.
  const matchingSafes = proposal.plugins.safeSnap.safes.filter((safe) =>
    isMatchingSafe(safe, params.chainId, transaction.address)
  );
  if (matchingSafes.length === 0) {
    return { verified: false, error: "No matching safe found" };
  } else if (matchingSafes.length > 1) {
    return { verified: false, error: "Multiple matching safes found" };
  }

  // Verify that on-chain proposed transactions match the transactions from the safeSnap plugin.
  const safe = matchingSafes[0];
  const safeSnapTransactions = safe.txs.map((tx) => tx.mainTransaction);
  const onChainTransactions = transaction.args.proposal.transactions;
  if (safeSnapTransactions.length !== onChainTransactions.length) {
    return { verified: false, error: "Number of transactions do not match" };
  }
  for (let i = 0; i < safeSnapTransactions.length; i++) {
    const safeSnapTransaction = safeSnapTransactions[i];
    const onChainTransaction = onChainTransactions[i];
    if (
      ethersUtils.getAddress(safeSnapTransaction.to) !== ethersUtils.getAddress(onChainTransaction.to) ||
      safeSnapTransaction.data.toLowerCase() !== onChainTransaction.data.toLowerCase() ||
      safeSnapTransaction.value !== onChainTransaction.value.toString() ||
      safeSnapTransaction.operation !== onChainTransaction.operation.toString()
    ) {
      return { verified: false, error: "Transactions do not match Snapshot proposal" };
    }
  }

  // Verify IPFS data is available and matches GraphQL data.
  const ipfsData = await getIpfsData(ipfsHash, params.ipfsEndpoint, params.retryOptions);
  if (ipfsData instanceof Error) {
    return { verified: false, error: `IPFS request failed with error ${ipfsData.message}` };
  }
  if (!ipfsMatchGraphql(ipfsData, graphqlData)) {
    return { verified: false, error: "IPFS data properties do not match GraphQL data" };
  }

  // Verify rules and its parsed properties.
  const parsedRules = parseRules(transaction.args.rules);
  if (parsedRules === null) {
    return { verified: false, error: "Rules do not match standard template" };
  }
  if (parsedRules.space !== proposal.space.id) {
    return {
      verified: false,
      error: `Snapshot proposal space ${proposal.space.id} does not match ${parsedRules.space} in rules`,
    };
  }
  if (proposal.scores_total < parsedRules.quorum) {
    return { verified: false, error: `Proposal did not meet rules quorum of ${parsedRules.quorum}` };
  }
  if ((proposal.end - proposal.start) * 3600 < parsedRules.votingPeriod) {
    return {
      verified: false,
      error: `Proposal voting period was shorter than ${parsedRules.votingPeriod} hours required by rules`,
    };
  }

  return { verified: true };
};
