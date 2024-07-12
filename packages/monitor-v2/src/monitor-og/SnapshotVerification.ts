import {
  ProposalExecutedEvent,
  TransactionsProposedEvent,
} from "@uma/contracts-node/typechain/core/ethers/OptimisticGovernor";
import assert from "assert";
import retry, { Options as RetryOptions } from "async-retry";
import { BigNumber, utils as ethersUtils } from "ethers";
import { CID } from "multiformats/cid";
import fetch, { Response } from "node-fetch";
import { request } from "graphql-request";
import { gql } from "graphql-tag";

import { isDictionary, getOgByAddress, MonitoringParams, runQueryFilter, tryHexToUtf8String } from "./common";

// oSnap plugin type for formatted transaction.
type OptimisticGovernorTransaction = [to: string, operation: 0, value: string, data: string];

// oSnap plugin type for transactions. We only include properties that will be verified by the bot.
interface BaseTransaction {
  formatted: OptimisticGovernorTransaction;
}

// oSnap plugin type for safe. We only include properties that will be verified by the bot.
interface GnosisSafe {
  network: string;
  moduleAddress: string;
  transactions: BaseTransaction[];
}

// oSnap plugin data type.
interface OsnapPluginData {
  safes: GnosisSafe[];
}

// oSnap plugin type, will be translated to safeSnap type for the verification.
interface OsnapPlugin {
  oSnap: OsnapPluginData;
}

// Legacy oSnap plugin data type (with a single safe).
interface LegacyOsnapPluginData {
  safe: GnosisSafe;
}

// Legacy oSnap plugin type (with a single safe), will be translated to safeSnap type for the verification.
interface LegacyOsnapPlugin {
  oSnap: LegacyOsnapPluginData;
}

// safeSnap plugin type for mainTransaction. If there are multiple transactions within a batch, they are aggregated as
// multiSend in the mainTransaction.
export interface MainTransaction {
  to: string;
  data: string;
  value: string;
  operation: "0" | "1"; // Operation type: 0 == call, 1 == delegate call.
}

// safeSnap plugin type for safe. We only include properties that will be verified by the bot.
export interface SafeSnapSafe {
  txs: { mainTransaction: MainTransaction }[];
  network: string;
  umaAddress: string;
}

interface SafeSnapPluginData {
  safes: SafeSnapSafe[];
}

interface SafeSnapPlugin {
  safeSnap: SafeSnapPluginData;
}

// We only type the properties required in the verification. IPFS hosted proposal object includes additional properties
// that we don't look at.
interface SnapshotProposalIpfs {
  space: string;
  type: string;
  choices: string[];
  plugins: SafeSnapPlugin | OsnapPlugin | LegacyOsnapPlugin;
}

// We only type the properties requested in the GraphQL queries. This extends SnapshotProposalIpfs, but we need to
// override the space property.
export interface SnapshotProposalGraphql extends Omit<SnapshotProposalIpfs, "space"> {
  id: string;
  ipfs: string;
  state: string;
  space: { id: string };
  start: number;
  end: number;
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

export type VerificationResponse = { verified: true } | { verified: false; error: string; serverError?: boolean };

export interface RulesParameters {
  space: string;
  quorum: number;
  votingPeriod: number;
}

// Custom error to detect when IPFS fetch failed.
class IpfsFetchError extends Error {
  constructor(error: Error) {
    super(error.message);
    Error.captureStackTrace(this, IpfsFetchError);
    Object.setPrototypeOf(this, IpfsFetchError.prototype);
  }
}

// Type guard for OptimisticGovernorTransaction (oSnap plugin).
const isOptimisticGovernorTransaction = (transaction: unknown): transaction is OptimisticGovernorTransaction => {
  if (!Array.isArray(transaction) || transaction.length !== 4) return false;
  try {
    BigNumber.from(transaction[2]); // tx value.
  } catch {
    return false;
  }
  return (
    typeof transaction[0] === "string" && // tx to.
    ethersUtils.isAddress(transaction[0]) &&
    transaction[1] === 0 && // tx operation.
    typeof transaction[2] === "string" && // tx value.
    BigNumber.from(transaction[2]).gte(0) &&
    ethersUtils.isBytesLike(transaction[3]) // tx data.
  );
};

// Type guard for BaseTransaction (oSnap plugin).
const isBaseTransaction = (transaction: unknown): transaction is BaseTransaction => {
  return isDictionary(transaction) && isOptimisticGovernorTransaction(transaction.formatted);
};

// Type guard for GnosisSafe (oSnap plugin).
const isGnosisSafe = (safe: unknown): safe is GnosisSafe => {
  return (
    isDictionary(safe) &&
    typeof safe.network === "string" &&
    Number.isInteger(Number(safe.network)) &&
    Number(safe.network) > 0 &&
    typeof safe.moduleAddress === "string" &&
    ethersUtils.isAddress(safe.moduleAddress) &&
    Array.isArray(safe.transactions) &&
    safe.transactions.every((tx) => isBaseTransaction(tx))
  );
};

// Type guard for OsnapPlugin.
const isOsnapPlugin = (plugin: unknown): plugin is OsnapPlugin => {
  return (
    isDictionary(plugin) &&
    isDictionary(plugin.oSnap) &&
    Array.isArray(plugin.oSnap.safes) &&
    plugin.oSnap.safes.every((safe) => isGnosisSafe(safe))
  );
};

// Type guard for LegacyOsnapPlugin.
const isLegacyOsnapPlugin = (plugin: unknown): plugin is LegacyOsnapPlugin => {
  return isDictionary(plugin) && isDictionary(plugin.oSnap) && isGnosisSafe(plugin.oSnap.safe);
};

// Type guard for MainTransaction (safeSnap plugin).
const isMainTransaction = (transaction: unknown): transaction is MainTransaction => {
  if (!isDictionary(transaction)) return false;
  try {
    BigNumber.from(transaction.value);
  } catch {
    return false;
  }
  return (
    typeof transaction.to === "string" &&
    ethersUtils.isAddress(transaction.to) &&
    ethersUtils.isBytesLike(transaction.data) &&
    typeof transaction.value === "string" &&
    BigNumber.from(transaction.value).gte(0) &&
    (transaction.operation === "0" || transaction.operation === "1")
  );
};

// Type guard for SafeSnapSafe (safeSnap plugin).
const isSafeSnapSafe = (safe: unknown): safe is SafeSnapSafe => {
  return (
    isDictionary(safe) &&
    Array.isArray(safe.txs) &&
    safe.txs.every((tx) => isMainTransaction(tx.mainTransaction)) &&
    typeof safe.network === "string" &&
    Number.isInteger(Number(safe.network)) &&
    Number(safe.network) > 0 &&
    typeof safe.umaAddress === "string" &&
    ethersUtils.isAddress(safe.umaAddress)
  );
};

// Type guard for SafeSnapPlugin.
const isSafeSnapPlugin = (plugin: unknown): plugin is SafeSnapPlugin => {
  return (
    isDictionary(plugin) &&
    isDictionary(plugin.safeSnap) &&
    Array.isArray(plugin.safeSnap.safes) &&
    plugin.safeSnap.safes.every((safe) => isSafeSnapSafe(safe))
  );
};

// Type guard for SnapshotProposalIpfs.
const isSnapshotProposalIpfs = (proposal: unknown): proposal is SnapshotProposalIpfs => {
  return (
    isDictionary(proposal) &&
    typeof proposal.space === "string" &&
    typeof proposal.type === "string" &&
    Array.isArray(proposal.choices) &&
    proposal.choices.every((choice) => typeof choice === "string") &&
    (isSafeSnapPlugin(proposal.plugins) || isLegacyOsnapPlugin(proposal.plugins) || isOsnapPlugin(proposal.plugins)) &&
    !("safeSnap" in proposal.plugins && "oSnap" in proposal.plugins) // We don't support both plugins at the same time.
  );
};

// Type guard for SnapshotProposalGraphql.
export const isSnapshotProposalGraphql = (proposal: unknown): proposal is SnapshotProposalGraphql => {
  if (!isDictionary(proposal)) return false;
  // SnapshotProposalGraphql is derived from SnapshotProposalIpfs, except for the space property that is overridden.
  if (!isDictionary(proposal.space) || typeof proposal.space.id !== "string") return false;
  const ipfsProposal = { ...proposal, space: proposal.space.id };
  return (
    isSnapshotProposalIpfs(ipfsProposal) &&
    typeof proposal.id === "string" &&
    typeof proposal.ipfs === "string" &&
    typeof proposal.state === "string" &&
    typeof proposal.start === "number" &&
    typeof proposal.end === "number" &&
    Array.isArray(proposal.scores) &&
    proposal.scores.every((score) => typeof score === "number") &&
    typeof proposal.quorum === "number" &&
    typeof proposal.scores_total === "number"
  );
};

// Type guard for GraphqlData.
const isGraphqlData = (data: unknown): data is GraphqlData => {
  return (
    isDictionary(data) &&
    Array.isArray(data.proposals) &&
    data.proposals.every((proposal) => isSnapshotProposalGraphql(proposal))
  );
};

// Type guard for IpfsData.
const isIpfsData = (data: unknown): data is IpfsData => {
  return (
    isDictionary(data) &&
    isDictionary(data.data) &&
    isDictionary(data.data.message) &&
    isSnapshotProposalIpfs(data.data.message)
  );
};

// Translates oSnap plugin transaction to safeSnap plugin mainTransaction.
const baseTransactionToMainTransaction = (baseTransaction: BaseTransaction): MainTransaction => {
  const [to, , value, data] = baseTransaction.formatted; // We ignore the operation as it is always 0.
  return { to, operation: "0", value, data };
};

// Translates potential single safe LegacyOsnapPluginData to OsnapPluginData.
const translateToOsnapData = (pluginData: LegacyOsnapPluginData | OsnapPluginData): OsnapPluginData => {
  if ("safes" in pluginData) return pluginData; // Already OsnapPluginData.

  return { safes: [pluginData.safe] };
};

// Translates plugin to safeSnap plugin.
export const translateToSafeSnap = (plugin: SafeSnapPlugin | LegacyOsnapPlugin | OsnapPlugin): SafeSnapPlugin => {
  if ("safeSnap" in plugin) return plugin; // Already safeSnap plugin.

  const safeSnapPlugin: SafeSnapPlugin = { safeSnap: { safes: [] } };
  const oSnapPluginData = translateToOsnapData(plugin.oSnap); // Make sure to have multi safe oSnap data.

  oSnapPluginData.safes.forEach((safe) => {
    const safeSnapSafe: SafeSnapSafe = {
      txs: safe.transactions.map((tx) => ({ mainTransaction: baseTransactionToMainTransaction(tx) })),
      network: safe.network,
      umaAddress: safe.moduleAddress,
    };
    safeSnapPlugin.safeSnap.safes.push(safeSnapSafe);
  });
  return safeSnapPlugin;
};

// Returns null if the rules string does not match the expected template.
export const parseRules = (rules: string): RulesParameters | null => {
  // This is based on the template from Zodiac app at
  // https://github.com/gnosis/zodiac-safe-app/blob/79dbb72af506f60fcc16599516ce48f893393b29/packages/app/src/views/AddModule/wizards/OptimisticGovernorModule/OptimisticGovernorModuleModal.tsx#L136
  const regex = /^I assert that this transaction proposal is valid according to the following rules: Proposals approved on Snapshot, as verified at https:\/\/snapshot\.org\/#\/([a-zA-Z0-9-.]+)\/?, are valid as long as there is a minimum quorum of (\d+) and a minimum voting period of (\d+) hours and it does not appear that the Snapshot voting system is being exploited or is otherwise unavailable\. The quorum and voting period are minimum requirements for a proposal to be valid\. Quorum and voting period values set for a specific proposal in Snapshot should be used if they are more strict than the rules parameter\. The explanation included with the on-chain proposal must be the unique IPFS identifier for the specific Snapshot proposal that was approved or a unique identifier for a proposal in an alternative voting system approved by DAO social consensus if Snapshot is being exploited or is otherwise unavailable.$/;

  const match = rules.match(regex);
  if (!match) {
    return null;
  }

  const space = match[1];
  const quorum = parseInt(match[2]);
  const votingPeriod = parseInt(match[3]);

  return { space, quorum, votingPeriod };
};

// Try parsing IPFS hash to validate it. This should also protect against replay attacks with different CIDv1 casing.
const isIpfsHashValid = (ipfsHash: string): boolean => {
  try {
    CID.parse(ipfsHash);
    return true;
  } catch {
    return false;
  }
};

// We don't want to throw an error if the GraphQL request fails for any reason, so we return an Error object instead
// that will be logged by the bot.
const getGraphqlData = async (ipfsHash: string, url: string, retryOptions: RetryOptions): Promise<unknown | Error> => {
  const query = gql(/* GraphQL */ `
    query GetProposals($ipfsHash: String) {
      proposals(first: 2, where: { ipfs: $ipfsHash }, orderBy: "created", orderDirection: desc) {
        id
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

// We don't want to throw an error if the IPFS request fails for any reason, so we return an Error object instead that
// will be logged by the bot.
const getIpfsData = async (
  ipfsHash: string,
  url: string,
  strictValidation: boolean,
  retryOptions: RetryOptions
): Promise<unknown | Error> => {
  let response: Response;

  // Separate try/catch block to catch errors from the fetch() call itself.
  try {
    response = await retry(async () => await fetch(`${url}/${ipfsHash}`), retryOptions);
  } catch (error) {
    assert(error instanceof Error, "Unexpected Error type!");
    return new IpfsFetchError(error); // This happens when the IPFS gateway is not returning HTTP response.
  }
  if (!response.ok) {
    const validationError = new Error(`Request on ${response.url} failed with status ${response.status}`);
    if (strictValidation) return validationError;
    return new IpfsFetchError(validationError); // Caller would detect the wrapped error to identify it as server issue.
  }

  try {
    const data = await response.json();

    // Try to parse the plugins property as JSON.
    data.data.message.plugins = JSON.parse(data.data.message.plugins);
    return data;
  } catch (error) {
    assert(error instanceof Error, "Unexpected Error type!");
    return error;
  }
};

const ipfsMatchGraphql = (ipfsData: IpfsData, graphqlProposal: SnapshotProposalGraphql): boolean => {
  const ipfsProposal = ipfsData.data.message;

  // Verify common properties, except for plugin.
  if (
    ipfsProposal.space !== graphqlProposal.space.id ||
    ipfsProposal.type !== graphqlProposal.type ||
    JSON.stringify(ipfsProposal.choices) !== JSON.stringify(graphqlProposal.choices)
  ) {
    return false;
  }

  // Make sure to use safeSnap plugin format for verification.
  const ipfsSafeSnapPlugin = translateToSafeSnap(ipfsProposal.plugins);
  const graphqlSafeSnapPlugin = translateToSafeSnap(graphqlProposal.plugins);

  // Verify that both data sources has the same number of safes in the safeSnap plugin (ignoring safes with no txs).
  const ipfsSafes = ipfsSafeSnapPlugin.safeSnap.safes.filter((safe) => safe.txs.length > 0);
  const graphqlSafes = graphqlSafeSnapPlugin.safeSnap.safes.filter((safe) => safe.txs.length > 0);
  if (ipfsSafes.length !== graphqlSafes.length) {
    return false;
  }

  // Verify that the safes match. We inspect only the properties that are required for verification.
  for (let i = 0; i < ipfsSafes.length; i++) {
    const ipfsSafe = ipfsSafes[i];
    const graphqlSafe = graphqlSafes[i];

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

const verifyProposalChoices = (proposal: SnapshotProposalGraphql, params: MonitoringParams): VerificationResponse => {
  // Verify proposal type.
  if (proposal.type !== "single-choice" && proposal.type !== "basic") {
    return { verified: false, error: `Proposal type ${proposal.type} is not supported` };
  }

  // Verify that the basic proposal has expected choices.
  if (proposal.type === "basic") {
    // Assert that the basic proposal has expected choices. We error immediately as this indicates a problem with the
    // Snapshot backend.
    assert(proposal.choices.length === 3, "Basic proposal must have three choices");
    assert(proposal.choices[0] === "For", "Basic proposal must have 'For' as the first choice");
    assert(proposal.choices[1] === "Against", "Basic proposal must have 'Against' as the second choice");
    assert(proposal.choices[2] === "Abstain", "Basic proposal must have 'Abstain' as the third choice");
    return { verified: true };
  }

  // Verify that the the single-choice proposal has exactly one matching approval choice.
  const matchingChoices = proposal.choices.filter((choice) =>
    params.approvalChoices.map((approvalChoice) => approvalChoice.toLowerCase()).includes(choice.toLowerCase())
  );
  if (matchingChoices.length === 0) {
    return { verified: false, error: `No known approval choice found among ${JSON.stringify(proposal.choices)}` };
  } else if (matchingChoices.length > 1) {
    return {
      verified: false,
      error: `Multiple approval choices found among ${JSON.stringify(proposal.choices)}`,
    };
  }
  return { verified: true };
};

// This should be run against verified proposal choices only, so it should always return a matching choice index.
const getApprovalIndex = (proposal: SnapshotProposalGraphql, params: MonitoringParams): number => {
  if (proposal.type === "basic") return 0;

  return proposal.choices.findIndex((choice) =>
    params.approvalChoices.map((approvalChoice) => approvalChoice.toLowerCase()).includes(choice.toLowerCase())
  );
};

// Verify that the proposal was approved properly on Snapshot.
export const verifyVoteOutcome = (
  proposal: SnapshotProposalGraphql,
  proposalTime: number,
  approvalIndex: number
): VerificationResponse => {
  // Verify that the proposal is in the closed state.
  if (proposal.state !== "closed") return { verified: false, error: "Proposal not in closed state" };

  // Verify that the proposal voting period has ended.
  if (proposalTime < proposal.end) return { verified: false, error: "Proposal voting period has not ended" };

  // Verify quorum.
  if (proposal.scores_total !== null && proposal.scores_total < proposal.quorum)
    return { verified: false, error: `Proposal did not meet Snapshot quorum of ${proposal.quorum}` };

  // Verify proposal scores.
  if (proposal.scores === null || proposal.scores.length !== proposal.choices.length)
    return { verified: false, error: "Proposal scores are not valid" };

  // Verify that the proposal was approved by majority and got more than 50% of the votes.
  if (approvalIndex !== proposal.scores.indexOf(Math.max(...proposal.scores)))
    return { verified: false, error: "Proposal was not approved by majority" };
  if (proposal.scores_total !== null && proposal.scores[approvalIndex] <= proposal.scores_total / 2)
    return { verified: false, error: "Proposal did not get more than 50% votes" };

  // Vote verification passed.
  return { verified: true };
};

export const isMatchingSafe = (safe: SafeSnapSafe, chainId: number, ogAddress: string): boolean => {
  return (
    safe.network === chainId.toString() && ethersUtils.getAddress(safe.umaAddress) === ethersUtils.getAddress(ogAddress)
  );
};

// Verify that on-chain proposed transactions match the transactions from the safeSnap plugin.
export const onChainTxsMatchSnapshot = (proposalEvent: TransactionsProposedEvent, safe: SafeSnapSafe): boolean => {
  const safeSnapTransactions = safe.txs.map((tx) => tx.mainTransaction);
  const onChainTransactions = proposalEvent.args.proposal.transactions;
  if (safeSnapTransactions.length !== onChainTransactions.length) return false;
  for (let i = 0; i < safeSnapTransactions.length; i++) {
    const safeSnapTransaction = safeSnapTransactions[i];
    const onChainTransaction = onChainTransactions[i];
    if (
      ethersUtils.getAddress(safeSnapTransaction.to) !== ethersUtils.getAddress(onChainTransaction.to) ||
      safeSnapTransaction.data.toLowerCase() !== onChainTransaction.data.toLowerCase() ||
      safeSnapTransaction.value !== onChainTransaction.value.toString() ||
      safeSnapTransaction.operation !== onChainTransaction.operation.toString()
    )
      return false;
  }
  return true;
};

// Verify IPFS data is available and matches GraphQL data.
export const verifyIpfs = async (
  graphqlProposal: SnapshotProposalGraphql,
  params: MonitoringParams
): Promise<VerificationResponse> => {
  const { disputeIpfsServerErrors, ipfsEndpoint, retryOptions } = params;
  const ipfsData = await getIpfsData(graphqlProposal.ipfs, ipfsEndpoint, disputeIpfsServerErrors, retryOptions);

  // In case of error we detect its instance type to flag this as server error so that caller can abstain from dispute.
  // With disputeIpfsServerErrors enabled we mark it as server error only if the IPFS gateway did not return HTTP response.
  // With disputeIpfsServerErrors disabled we also mark it as server error if the IPFS gateway returned non-OK response.
  if (ipfsData instanceof IpfsFetchError)
    return { verified: false, error: `IPFS request failed with error ${ipfsData.message}`, serverError: true };
  if (ipfsData instanceof Error)
    return { verified: false, error: `IPFS request failed with error ${ipfsData.message}` };
  if (!isIpfsData(ipfsData)) return { verified: false, error: "IPFS data does not match expected format" };
  if (!ipfsMatchGraphql(ipfsData, graphqlProposal))
    return { verified: false, error: "IPFS data properties do not match GraphQL data" };
  return { verified: true };
};

// Verify proposal against parsed rules.
export const verifyRules = (parsedRules: RulesParameters, proposal: SnapshotProposalGraphql): VerificationResponse => {
  // Check space id.
  if (parsedRules.space !== proposal.space.id)
    return {
      verified: false,
      error: `Snapshot proposal space ${proposal.space.id} does not match ${parsedRules.space} in rules`,
    };

  // Check rules quorum.
  if (proposal.scores_total < parsedRules.quorum)
    return { verified: false, error: `Proposal did not meet rules quorum of ${parsedRules.quorum}` };

  // Check rules voting period.
  if (proposal.end - proposal.start < parsedRules.votingPeriod * 3600)
    return {
      verified: false,
      error: `Proposal voting period was shorter than ${parsedRules.votingPeriod} hours required by rules`,
    };

  // Rules verification passed.
  return { verified: true };
};

// Check if the proposal has been executed before.
const hasBeenExecuted = async (
  currentProposal: TransactionsProposedEvent,
  params: MonitoringParams
): Promise<boolean> => {
  // Get all other proposals with matching transactions and explanation for the same module that were proposed till the
  // the current proposal's block number. Matching proposals will include the current proposal, but we know that it
  // cannot be executed in the same block as liveness cannot be 0.
  const og = await getOgByAddress(params, currentProposal.address);
  const matchingProposals = (
    await runQueryFilter<TransactionsProposedEvent>(og, og.filters.TransactionsProposed(), {
      start: 0,
      end: currentProposal.blockNumber,
    })
  ).filter(
    (otherProposal) =>
      otherProposal.args.proposalHash === currentProposal.args.proposalHash &&
      otherProposal.args.explanation === currentProposal.args.explanation
  );

  // Return true if any of the matching proposals have been executed.
  const executedAssertionIds = new Set(
    (
      await runQueryFilter<ProposalExecutedEvent>(og, og.filters.ProposalExecuted(), {
        start: 0,
        end: currentProposal.blockNumber,
      })
    ).map((executedProposal) => executedProposal.args.assertionId)
  );
  return matchingProposals.some((matchingProposal) => executedAssertionIds.has(matchingProposal.args.assertionId));
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

  // Validate IPFS hash.
  if (!isIpfsHashValid(ipfsHash)) return { verified: false, error: `IPFS hash ${ipfsHash} is not valid` };

  // Get proposal data from GraphQL.
  const graphqlData = await getGraphqlData(ipfsHash, params.graphqlEndpoint, params.retryOptions);
  if (graphqlData instanceof Error) {
    return { verified: false, error: `GraphQL request failed with error ${graphqlData.message}`, serverError: true };
  }
  if (!isGraphqlData(graphqlData)) {
    return { verified: false, error: "GraphQL data does not match expected format" };
  }

  // Verify that the proposal exists and is unique.
  if (graphqlData.proposals.length === 0) {
    return { verified: false, error: `No proposal found for IPFS hash ${ipfsHash}` };
  } else if (graphqlData.proposals.length > 1) {
    return { verified: false, error: `Duplicate proposals found for IPFS hash ${ipfsHash}` };
  }

  // Verify proposal type and approval choices.
  const proposal = graphqlData.proposals[0];
  const proposalTypeVerification = verifyProposalChoices(proposal, params);
  if (!proposalTypeVerification.verified) return proposalTypeVerification;
  const approvalIndex = getApprovalIndex(proposal, params);

  // Verify that the proposal was approved properly on Snapshot.
  const approvalVerification = verifyVoteOutcome(proposal, transaction.args.proposalTime.toNumber(), approvalIndex);
  if (!approvalVerification.verified) return approvalVerification;

  // Make sure to use safeSnap plugin format for verification.
  const safeSnapPlugin = translateToSafeSnap(proposal.plugins);

  // There must be one and only one matching safe.
  const matchingSafes = safeSnapPlugin.safeSnap.safes.filter((safe) =>
    isMatchingSafe(safe, params.chainId, transaction.address)
  );
  if (matchingSafes.length === 0) {
    return { verified: false, error: "No matching safe found" };
  } else if (matchingSafes.length > 1) {
    return { verified: false, error: "Multiple matching safes found" };
  }

  // Verify that on-chain proposed transactions match the transactions from the safeSnap plugin.
  if (!onChainTxsMatchSnapshot(transaction, matchingSafes[0]))
    return { verified: false, error: "On-chain transactions do not match Snapshot proposal" };

  // Verify IPFS data is available and matches GraphQL data.
  const ipfsVerification = await verifyIpfs(proposal, params);
  if (!ipfsVerification.verified) return ipfsVerification;

  // Verify rules and its parsed properties.
  const parsedRules = parseRules(transaction.args.rules);
  if (parsedRules === null) {
    return { verified: false, error: "Rules do not match standard template" };
  }
  const rulesVerification = verifyRules(parsedRules, proposal);
  if (!rulesVerification.verified) return rulesVerification;

  // Verify that the same proposal has not been executed before.
  if (await hasBeenExecuted(transaction, params))
    return { verified: false, error: "Proposal has been executed before" };

  // All checks passed.
  return { verified: true };
};
