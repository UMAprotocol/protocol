import assert from "assert";
import request from "graphql-request";
import { gql } from "graphql-tag";

import { ethersUtils, MonitoringParams, TransactionsProposedEvent, tryHexToUtf8String } from "./common";

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

// We only type the properties requested in the GraphQL query.
// Properties that are optional in the GraphQL schema are set as potentially null.
interface SnapshotProposal {
  id: string;
  type: string | null;
  choices: string[];
  end: number;
  state: string;
  space: { id: string } | null;
  scores: number[] | null;
  quorum: number;
  scores_total: number | null;
  plugins: Partial<SafeSnapPlugin>; // This is any in the GraphQL schema, but we only care about potential safeSnap plugin.
}
interface GraphqlData {
  proposals: SnapshotProposal[];
}

interface VerificationResponse {
  verified: boolean;
  error?: string;
}

const getGraphqlData = async (ipfsHash: string, url: string): Promise<GraphqlData> => {
  const query = gql(/* GraphQL */ `
    query GetProposals($ipfsHash: String) {
      proposals(first: 2, where: { ipfs: $ipfsHash }, orderBy: "created", orderDirection: desc) {
        id
        type
        choices
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
  return await request<GraphqlData, { ipfsHash: string }>(url, query, { ipfsHash });
};

const findSafe = (safe: SafeSnapSafe, chainId: number, ogAddress: string): boolean => {
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

  const data = await getGraphqlData(ipfsHash, params.graphqlEndpoint);

  // Verify that the proposal exists and is unique.
  if (data.proposals.length === 0) {
    return { verified: false, error: `No proposal found for IPFS hash ${ipfsHash}` };
  } else if (data.proposals.length > 1) {
    return { verified: false, error: `Duplicate proposals found for IPFS hash ${ipfsHash}` };
  }

  // Verify proposal type.
  const proposal = data.proposals[0];
  if (proposal.type !== "single-choice" && proposal.type !== "basic") {
    return { verified: false, error: `Proposal type ${proposal.type} is not supported` };
  }
  if (proposal.type === "basic") {
    assert(proposal.choices.length === 3, "Basic proposal must have three choices");
    assert(proposal.choices[0] === "For", "Basic proposal must have 'For' as the first choice");
    assert(proposal.choices[1] === "Against", "Basic proposal must have 'Against' as the second choice");
    assert(proposal.choices[2] === "Abstain", "Basic proposal must have 'Abstain' as the third choice");
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
    return { verified: false, error: "Proposal did not meet quorum" };
  }

  // Verify proposal choices and scores.
  const approvalIndex = proposal.choices.findIndex((choice) =>
    params.approvalChoices.map((approvalChoice) => approvalChoice.toLowerCase()).includes(choice.toLowerCase())
  );
  if (approvalIndex === -1) {
    return { verified: false, error: `No known approval choice found among ${JSON.stringify(proposal.choices)}` };
  }
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
    findSafe(safe, params.chainId, transaction.address)
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
      return { verified: false, error: "Transactions do not match" };
    }
  }
  console.log(JSON.stringify(safe, null, 2));
  return { verified: true };
};
