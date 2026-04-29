import type { TransactionReceipt } from "@ethersproject/abstract-provider";
import type {
  VoteCommittedEvent,
  VoteRevealedEvent,
  VotingV2,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import Bluebird from "bluebird";
import { createHash } from "crypto";
import { BigNumber, Event, utils } from "ethers";
import fs from "fs";
import path from "path";

export interface RetryConfig {
  retries?: number;
  delay?: number;
}

export interface CalculateVoterGasRebateV2Config {
  voting: VotingV2;
  fromBlock: number;
  toBlock: number;
  minTokens: BigNumber;
  maxBlockLookBack: number;
  transactionConcurrency: number;
  maxPriorityFee: BigNumber | null;
  retryConfig?: RetryConfig;
}

export interface RebateTransactionEvidence {
  transactionHash: string;
  from: string;
  blockNumber: number;
  gasUsed: string;
  effectiveGasPrice: string;
  baseFee: string | null;
  actualPriorityFee: string | null;
  cappedPriorityFee: string | null;
  effectiveGasPriceForRebate: string;
  rebateWei: string;
}

export type RebateAnomalyType =
  | "reveal_missing_commit"
  | "missing_receipt"
  | "receipt_event_count_mismatch"
  | "provider_error";

export interface RebateAnomaly {
  type: RebateAnomalyType;
  message: string;
  fromBlock?: number;
  toBlock?: number;
  transactionHash?: string;
  voter?: string;
  details?: { [key: string]: string | number | null };
}

export interface EventCollectionStats {
  maxBlockLookBack: number;
  minBlockLookBack: number;
  rangesQueried: number;
  queryAttempts: number;
  retryCount: number;
  splitCount: number;
  validationFailures: number;
  providerErrors: number;
  receiptValidationCount: number;
  commitEventCount: number;
  revealEventCount: number;
  validationPassed: boolean;
}

export interface RebateComputationResult {
  votingContractAddress: string;
  fromBlock: number;
  toBlock: number;
  minStakedTokens: BigNumber;
  maxBlockLookBack: number;
  transactionConcurrency: number;
  maxPriorityFee: BigNumber | null;
  commitEvents: VoteCommittedEvent[];
  revealEvents: VoteRevealedEvent[];
  eligibleRevealEvents: VoteRevealedEvent[];
  matchingCommitEvents: VoteCommittedEvent[];
  transactionsToRefund: TransactionReceipt[];
  shareholderPayoutWei: { [address: string]: BigNumber };
  totalRebateWei: BigNumber;
  transactionEvidence: RebateTransactionEvidence[];
  eventCollectionStats: EventCollectionStats;
  anomalies: RebateAnomaly[];
}

export interface MonthlyAuditReportConfig {
  minStakedTokens: string;
  minStakedTokensWei: string;
  maxPriorityFeeGwei: string | null;
  maxPriorityFeeWei: string | null;
  maxBlockLookBack: number;
  transactionConcurrency: number;
  maxRetries: number;
  retryDelay: number;
  overrideFromBlockConfigured: boolean;
  overrideToBlockConfigured: boolean;
  customNodeUrlConfigured: boolean;
}

export interface MonthlyAuditReportOptions {
  outputRebateFilePath: string;
  rebateNumber: number;
  config: MonthlyAuditReportConfig;
  generatedAt?: string;
}

export interface MonthlyAuditReport {
  reportType: "VotingV2MonthlyGasRebateAudit";
  generatedAt: string;
  outputRebateFilePath: string;
  rebateNumber: number;
  votingContractAddress: string;
  blockRange: {
    fromBlock: number;
    toBlock: number;
  };
  effectiveConfig: MonthlyAuditReportConfig;
  counts: {
    commitEvents: number;
    revealEvents: number;
    eligibleRevealEvents: number;
    matchedCommitEvents: number;
    transactions: number;
    voters: number;
  };
  payout: {
    totalRebateWei: string;
    totalRebateEth: string;
  };
  eventCollection: EventCollectionStats;
  validation: {
    passed: boolean;
    anomalyCount: number;
  };
  anomalies: RebateAnomaly[];
  transactionEvidence: RebateTransactionEvidence[];
}

export interface MonthlyAuditReportPaths {
  jsonPath: string;
  markdownPath: string;
}

export interface WrittenMonthlyAuditReports extends MonthlyAuditReportPaths {
  report: MonthlyAuditReport;
}

export interface CorrectionManifestAuditEntry {
  rebateFile: string;
  rebateNumber: number;
  fromBlock: number;
  toBlock: number;
  minStakedTokens: string;
  maxPriorityFeeGwei: string | null;
  maxBlockLookBack: number;
  transactionConcurrency: number;
  notes?: string;
}

export interface CorrectionExpectedDelta {
  rebateNumber: number;
  address: string;
  deltaWei: string;
}

export interface CorrectionManifest {
  version: 1;
  name: string;
  votingContractAddress: string;
  outputPrefix: string;
  audits: CorrectionManifestAuditEntry[];
  expectedDeltas: CorrectionExpectedDelta[];
}

export interface PaidRebateFile {
  votingContractAddress: string;
  rebate: number;
  fromBlock: number;
  toBlock: number;
  countVoters: number;
  totalRebateAmount: number | string;
  shareholderPayout: { [address: string]: number | string };
}

export interface ValidatedCorrectionManifestAuditEntry extends CorrectionManifestAuditEntry {
  paidRebateFilePath: string;
  paidRebate: PaidRebateFile;
  minStakedTokensWei: string;
  maxPriorityFeeWei: string | null;
}

export interface ValidatedCorrectionManifest extends Omit<CorrectionManifest, "audits" | "expectedDeltas"> {
  audits: ValidatedCorrectionManifestAuditEntry[];
  expectedDeltas: CorrectionExpectedDelta[];
}

export interface CorrectionAddressDelta {
  address: string;
  paidWei: string;
  recomputedWei: string;
  deltaWei: string;
}

export interface CorrectionExpectedDeltaCheck {
  rebateNumber: number;
  address: string;
  expectedDeltaWei: string;
  actualDeltaWei: string;
  passed: boolean;
}

export interface CorrectionAuditRebateReport {
  rebateNumber: number;
  rebateFile: string;
  paidRebateFilePath: string;
  notes?: string;
  blockRange: {
    fromBlock: number;
    toBlock: number;
  };
  effectiveConfig: {
    minStakedTokens: string;
    minStakedTokensWei: string;
    maxPriorityFeeGwei: string | null;
    maxPriorityFeeWei: string | null;
    maxBlockLookBack: number;
    transactionConcurrency: number;
    maxRetries: number | null;
    retryDelay: number | null;
  };
  paid: {
    countVoters: number;
    totalRebateWei: string;
    totalRebateEth: string;
  };
  recomputed: {
    countVoters: number;
    totalRebateWei: string;
    totalRebateEth: string;
  };
  deltas: {
    positive: CorrectionAddressDelta[];
    zero: CorrectionAddressDelta[];
    negative: CorrectionAddressDelta[];
    positiveTotalWei: string;
    positiveTotalEth: string;
    negativeTotalWei: string;
    negativeTotalEth: string;
  };
  eventCollection: EventCollectionStats;
  anomalies: RebateAnomaly[];
  transactionEvidenceForPositiveDeltas: RebateTransactionEvidence[];
}

export interface CorrectionPayoutJson {
  votingContractAddress: string;
  rebate: number;
  fromBlock: number;
  toBlock: number;
  countVoters: number;
  totalRebateAmount: number;
  shareholderPayout: { [address: string]: number };
}

export interface CorrectionAuditReport {
  reportType: "VotingV2GasRebateCorrectionAudit";
  generatedAt: string;
  manifestPath: string;
  manifestHash: string;
  manifestName: string;
  outputPrefix: string;
  outputPaths: CorrectionArtifactPaths;
  votingContractAddress: string;
  customNodeUrlConfigured: boolean;
  validation: {
    passed: boolean;
    expectedDeltaChecksPassed: boolean;
    negativeDeltaCount: number;
    anomalyCount: number;
  };
  auditedRebates: CorrectionAuditRebateReport[];
  expectedDeltaChecks: CorrectionExpectedDeltaCheck[];
  consolidatedTopUp: {
    countVoters: number;
    totalWei: string;
    totalEth: string;
    shareholderPayoutWei: { [address: string]: string };
  };
}

export interface CorrectionArtifactPaths {
  payoutPath: string;
  auditJsonPath: string;
  auditMarkdownPath: string;
}

export interface WrittenCorrectionArtifacts extends CorrectionArtifactPaths {
  payout: CorrectionPayoutJson;
  report: CorrectionAuditReport;
}

export type CorrectionRebateCalculator = (
  config: CalculateVoterGasRebateV2Config,
  entry: ValidatedCorrectionManifestAuditEntry,
  manifest: ValidatedCorrectionManifest
) => Promise<RebateComputationResult>;

export interface RunVotingV2CorrectionAuditOptions {
  manifestPath: string;
  voting: VotingV2;
  outputDir: string;
  expectedVotingContractAddress?: string;
  baseDir?: string;
  allowOverwrite?: boolean;
  customNodeUrlConfigured?: boolean;
  retryConfig?: RetryConfig;
  generatedAt?: string;
  calculateRebate?: CorrectionRebateCalculator;
}

interface CollectedVotingEvents {
  commitEvents: VoteCommittedEvent[];
  revealEvents: VoteRevealedEvent[];
  receiptByTransactionHash: Map<string, TransactionReceipt>;
  eventCollectionStats: EventCollectionStats;
  anomalies: RebateAnomaly[];
}

interface CollectedRangeEvents {
  commitEvents: VoteCommittedEvent[];
  revealEvents: VoteRevealedEvent[];
}

interface TransactionEventCounts {
  commit: number;
  reveal: number;
}

export class EventCollectionValidationError extends Error {
  public readonly eventCollectionStats: EventCollectionStats;
  public readonly anomalies: RebateAnomaly[];

  constructor(message: string, eventCollectionStats: EventCollectionStats, anomalies: RebateAnomaly[]) {
    super(message);
    this.name = "EventCollectionValidationError";
    this.eventCollectionStats = eventCollectionStats;
    this.anomalies = anomalies;
  }
}

export class CorrectionManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorrectionManifestValidationError";
  }
}

export function getMonthlyAuditReportPaths(outputRebateFilePath: string): MonthlyAuditReportPaths {
  const parsedPath = path.parse(outputRebateFilePath);
  return {
    jsonPath: path.join(parsedPath.dir, `${parsedPath.name}.audit.json`),
    markdownPath: path.join(parsedPath.dir, `${parsedPath.name}.audit.md`),
  };
}

export function buildMonthlyAuditReport(
  result: RebateComputationResult,
  { outputRebateFilePath, rebateNumber, config, generatedAt }: MonthlyAuditReportOptions
): MonthlyAuditReport {
  return {
    reportType: "VotingV2MonthlyGasRebateAudit",
    generatedAt: generatedAt || new Date().toISOString(),
    outputRebateFilePath,
    rebateNumber,
    votingContractAddress: result.votingContractAddress,
    blockRange: {
      fromBlock: result.fromBlock,
      toBlock: result.toBlock,
    },
    effectiveConfig: {
      ...config,
    },
    counts: {
      commitEvents: result.commitEvents.length,
      revealEvents: result.revealEvents.length,
      eligibleRevealEvents: result.eligibleRevealEvents.length,
      matchedCommitEvents: result.matchingCommitEvents.length,
      transactions: result.transactionsToRefund.length,
      voters: Object.keys(result.shareholderPayoutWei).length,
    },
    payout: {
      totalRebateWei: result.totalRebateWei.toString(),
      totalRebateEth: utils.formatEther(result.totalRebateWei),
    },
    eventCollection: {
      ...result.eventCollectionStats,
    },
    validation: {
      passed: result.eventCollectionStats.validationPassed,
      anomalyCount: result.anomalies.length,
    },
    anomalies: result.anomalies,
    transactionEvidence: result.transactionEvidence,
  };
}

export function formatMonthlyAuditMarkdown(report: MonthlyAuditReport): string {
  const config = report.effectiveConfig;
  const collection = report.eventCollection;
  const anomalyLines =
    report.anomalies.length === 0
      ? ["- None"]
      : report.anomalies.map((anomaly) => {
          const location =
            anomaly.fromBlock !== undefined && anomaly.toBlock !== undefined
              ? ` (${anomaly.fromBlock}-${anomaly.toBlock})`
              : "";
          const transaction = anomaly.transactionHash ? ` tx ${anomaly.transactionHash}` : "";
          return `- ${anomaly.type}${location}${transaction}: ${anomaly.message}`;
        });

  return [
    `# VotingV2 Monthly Gas Rebate Audit - Rebate ${report.rebateNumber}`,
    "",
    `Generated at: ${report.generatedAt}`,
    `Output rebate file: \`${report.outputRebateFilePath}\``,
    `VotingV2 contract: \`${report.votingContractAddress}\``,
    `Block range: ${report.blockRange.fromBlock}-${report.blockRange.toBlock}`,
    "",
    "## Effective Config",
    "",
    `- Minimum staked tokens: ${config.minStakedTokens} UMA (${config.minStakedTokensWei} wei)`,
    `- Max priority fee: ${config.maxPriorityFeeGwei === null ? "none" : `${config.maxPriorityFeeGwei} gwei`}`,
    `- Max block lookback: ${config.maxBlockLookBack}`,
    `- Transaction concurrency: ${config.transactionConcurrency}`,
    `- Max retries: ${config.maxRetries}`,
    `- Retry delay: ${config.retryDelay} ms`,
    `- Override from block configured: ${config.overrideFromBlockConfigured}`,
    `- Override to block configured: ${config.overrideToBlockConfigured}`,
    `- Custom node URL configured: ${config.customNodeUrlConfigured}`,
    "",
    "## Summary",
    "",
    `- Commit events: ${report.counts.commitEvents}`,
    `- Reveal events: ${report.counts.revealEvents}`,
    `- Eligible reveal events: ${report.counts.eligibleRevealEvents}`,
    `- Matched commit events: ${report.counts.matchedCommitEvents}`,
    `- Transactions: ${report.counts.transactions}`,
    `- Voters: ${report.counts.voters}`,
    `- Total payout: ${report.payout.totalRebateWei} wei (${report.payout.totalRebateEth} ETH)`,
    "",
    "## Event Collection",
    "",
    `- Validation passed: ${report.validation.passed}`,
    `- Chunk size: ${collection.maxBlockLookBack}`,
    `- Ranges queried: ${collection.rangesQueried}`,
    `- Query attempts: ${collection.queryAttempts}`,
    `- Retry count: ${collection.retryCount}`,
    `- Split count: ${collection.splitCount}`,
    `- Validation failures: ${collection.validationFailures}`,
    `- Provider errors: ${collection.providerErrors}`,
    `- Receipt validations: ${collection.receiptValidationCount}`,
    "",
    "## Anomalies",
    "",
    ...anomalyLines,
    "",
  ].join("\n");
}

export function writeMonthlyAuditReports(
  result: RebateComputationResult,
  options: MonthlyAuditReportOptions
): WrittenMonthlyAuditReports {
  const report = buildMonthlyAuditReport(result, options);
  const { jsonPath, markdownPath } = getMonthlyAuditReportPaths(options.outputRebateFilePath);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 4));
  fs.writeFileSync(markdownPath, formatMonthlyAuditMarkdown(report));

  return {
    jsonPath,
    markdownPath,
    report,
  };
}

export async function retryAsyncOperation<T>(
  operation: () => Promise<T>,
  retries = 10,
  delay = 1000,
  onFailure?: (error: unknown, attempt: number, willRetry: boolean) => void
): Promise<T> {
  let attempt = 0;
  const maxAttempts = Math.max(1, retries);

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      const willRetry = attempt < maxAttempts;
      if (onFailure) onFailure(error, attempt, willRetry);

      if (willRetry) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw new Error(`Operation failed after ${maxAttempts} attempts: ${error}`);
      }
    }
  }
  throw new Error("This should never be reached");
}

export function sortEventsByBlockAndLogIndex<T extends Pick<Event, "blockNumber" | "logIndex">>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return a.logIndex - b.logIndex;
  });
}

function getVoteKey(event: VoteCommittedEvent | VoteRevealedEvent): string {
  return `${event.args.voter}-${event.args.roundId}-${event.args.identifier}-${event.args.time}-${event.args.ancillaryData}`;
}

export function getUniqueCommitEvents(commitEvents: VoteCommittedEvent[]): Map<string, VoteCommittedEvent> {
  const uniqueCommitEvents = new Map<string, VoteCommittedEvent>();

  for (const event of sortEventsByBlockAndLogIndex(commitEvents)) {
    const key = getVoteKey(event);
    if (!uniqueCommitEvents.has(key)) uniqueCommitEvents.set(key, event);
  }

  return uniqueCommitEvents;
}

export function getMatchingCommitEvents(
  uniqueCommitEvents: Map<string, VoteCommittedEvent>,
  revealEvents: VoteRevealedEvent[]
): VoteCommittedEvent[] {
  return revealEvents
    .map((event) => uniqueCommitEvents.get(getVoteKey(event)))
    .filter((event): event is VoteCommittedEvent => event !== undefined);
}

export function dedupeTransactionReceipts(transactions: TransactionReceipt[]): TransactionReceipt[] {
  return transactions.reduce((accumulator: TransactionReceipt[], current) => {
    if (!accumulator.find((transaction) => transaction.transactionHash === current.transactionHash))
      accumulator.push(current);

    return accumulator;
  }, []);
}

function createEventCollectionStats(maxBlockLookBack: number): EventCollectionStats {
  return {
    maxBlockLookBack,
    minBlockLookBack: 1,
    rangesQueried: 0,
    queryAttempts: 0,
    retryCount: 0,
    splitCount: 0,
    validationFailures: 0,
    providerErrors: 0,
    receiptValidationCount: 0,
    commitEventCount: 0,
    revealEventCount: 0,
    validationPassed: false,
  };
}

function getBlockRanges(fromBlock: number, toBlock: number, maxBlockLookBack: number): [number, number][] {
  if (fromBlock > toBlock) return [];
  if (maxBlockLookBack <= 0) throw new Error("Cannot set maxBlockLookBack <= 0");

  const ranges: [number, number][] = [];
  for (let rangeStart = fromBlock; rangeStart <= toBlock; rangeStart += maxBlockLookBack) {
    ranges.push([rangeStart, Math.min(rangeStart + maxBlockLookBack - 1, toBlock)]);
  }
  return ranges;
}

function getEventTopic(voting: VotingV2, eventName: "VoteCommitted" | "VoteRevealed"): string {
  const contractInterface = (voting as any).interface;
  if (contractInterface?.getEventTopic) return contractInterface.getEventTopic(eventName);

  const filter = eventName === "VoteCommitted" ? voting.filters.VoteCommitted() : voting.filters.VoteRevealed();
  const topics = (filter as any).topics;
  return Array.isArray(topics) && typeof topics[0] === "string" ? topics[0] : eventName;
}

function countReceiptEventLogs(receipt: TransactionReceipt, votingAddress: string, topic: string): number {
  const votingAddressLower = votingAddress.toLowerCase();
  const topicLower = topic.toLowerCase();
  const logs = receipt.logs || [];

  return logs.filter(
    (log) => log.address.toLowerCase() === votingAddressLower && log.topics[0]?.toLowerCase() === topicLower
  ).length;
}

function addProviderFailureStats(stats: EventCollectionStats, _error: unknown, _attempt: number, willRetry: boolean) {
  stats.providerErrors++;
  if (willRetry) stats.retryCount++;
}

async function queryEventsForRange<T extends Event>(
  voting: VotingV2,
  filter: ReturnType<VotingV2["filters"]["VoteCommitted"]> | ReturnType<VotingV2["filters"]["VoteRevealed"]>,
  fromBlock: number,
  toBlock: number,
  stats: EventCollectionStats,
  retryConfig?: RetryConfig
): Promise<T[]> {
  const events = await retryAsyncOperation(
    async () => {
      stats.queryAttempts++;
      return ((await voting.queryFilter(filter, fromBlock, toBlock)) as unknown) as T[];
    },
    retryConfig?.retries,
    retryConfig?.delay,
    (error, attempt, willRetry) => addProviderFailureStats(stats, error, attempt, willRetry)
  );

  return events.filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
}

async function queryVotingEventsForRange(
  voting: VotingV2,
  fromBlock: number,
  toBlock: number,
  stats: EventCollectionStats,
  anomalies: RebateAnomaly[],
  retryConfig?: RetryConfig
): Promise<CollectedRangeEvents> {
  try {
    const [commitEvents, revealEvents] = await Promise.all([
      queryEventsForRange<VoteCommittedEvent>(
        voting,
        voting.filters.VoteCommitted(),
        fromBlock,
        toBlock,
        stats,
        retryConfig
      ),
      queryEventsForRange<VoteRevealedEvent>(
        voting,
        voting.filters.VoteRevealed(),
        fromBlock,
        toBlock,
        stats,
        retryConfig
      ),
    ]);

    return {
      commitEvents: sortEventsByBlockAndLogIndex(commitEvents),
      revealEvents: sortEventsByBlockAndLogIndex(revealEvents),
    };
  } catch (error) {
    anomalies.push({
      type: "provider_error",
      message: `Failed to query VotingV2 events for block range ${fromBlock}-${toBlock}: ${error}`,
      fromBlock,
      toBlock,
    });
    stats.validationPassed = false;
    throw new EventCollectionValidationError(
      `VotingV2 event query failed for block range ${fromBlock}-${toBlock}`,
      stats,
      anomalies
    );
  }
}

function countCollectedEventsByTransaction(
  commitEvents: VoteCommittedEvent[],
  revealEvents: VoteRevealedEvent[]
): Map<string, TransactionEventCounts> {
  const counts = new Map<string, TransactionEventCounts>();
  const increment = (transactionHash: string, eventType: keyof TransactionEventCounts) => {
    const current = counts.get(transactionHash) || { commit: 0, reveal: 0 };
    current[eventType]++;
    counts.set(transactionHash, current);
  };

  for (const event of commitEvents) increment(event.transactionHash, "commit");
  for (const event of revealEvents) increment(event.transactionHash, "reveal");

  return counts;
}

async function validateCollectedRange(
  voting: VotingV2,
  fromBlock: number,
  toBlock: number,
  commitEvents: VoteCommittedEvent[],
  revealEvents: VoteRevealedEvent[],
  receiptByTransactionHash: Map<string, TransactionReceipt>,
  transactionConcurrency: number,
  stats: EventCollectionStats,
  anomalies: RebateAnomaly[],
  retryConfig?: RetryConfig
): Promise<boolean> {
  const collectedCounts = countCollectedEventsByTransaction(commitEvents, revealEvents);
  const transactionHashes = [...collectedCounts.keys()].sort();
  if (transactionHashes.length === 0) return true;

  const voteCommittedTopic = getEventTopic(voting, "VoteCommitted");
  const voteRevealedTopic = getEventTopic(voting, "VoteRevealed");
  const validationAnomalies: RebateAnomaly[] = [];

  try {
    await Bluebird.map(
      transactionHashes,
      async (transactionHash) => {
        const receipt = await retryAsyncOperation(
          async () => await voting.provider.getTransactionReceipt(transactionHash),
          retryConfig?.retries,
          retryConfig?.delay,
          (error, attempt, willRetry) => addProviderFailureStats(stats, error, attempt, willRetry)
        );

        stats.receiptValidationCount++;
        if (!receipt) {
          validationAnomalies.push({
            type: "missing_receipt",
            message: `Missing transaction receipt for discovered VotingV2 event transaction ${transactionHash}`,
            fromBlock,
            toBlock,
            transactionHash,
          });
          return;
        }

        receiptByTransactionHash.set(transactionHash, receipt);
        const collected = collectedCounts.get(transactionHash) as TransactionEventCounts;
        const receiptCommitCount = countReceiptEventLogs(receipt, voting.address, voteCommittedTopic);
        const receiptRevealCount = countReceiptEventLogs(receipt, voting.address, voteRevealedTopic);

        if (receiptCommitCount !== collected.commit || receiptRevealCount !== collected.reveal) {
          validationAnomalies.push({
            type: "receipt_event_count_mismatch",
            message:
              `Receipt log count mismatch for ${transactionHash}: ` +
              `collected ${collected.commit} commits/${collected.reveal} reveals, ` +
              `receipt has ${receiptCommitCount} commits/${receiptRevealCount} reveals`,
            fromBlock,
            toBlock,
            transactionHash,
            details: {
              collectedCommitCount: collected.commit,
              collectedRevealCount: collected.reveal,
              receiptCommitCount,
              receiptRevealCount,
            },
          });
        }
      },
      { concurrency: transactionConcurrency }
    );
  } catch (error) {
    anomalies.push({
      type: "provider_error",
      message: `Failed to validate VotingV2 event receipt logs for block range ${fromBlock}-${toBlock}: ${error}`,
      fromBlock,
      toBlock,
    });
    stats.validationPassed = false;
    throw new EventCollectionValidationError(
      `VotingV2 event receipt validation failed for block range ${fromBlock}-${toBlock}`,
      stats,
      anomalies
    );
  }

  anomalies.push(...validationAnomalies);
  return validationAnomalies.length === 0;
}

async function collectRangeWithValidation(
  voting: VotingV2,
  fromBlock: number,
  toBlock: number,
  transactionConcurrency: number,
  stats: EventCollectionStats,
  anomalies: RebateAnomaly[],
  receiptByTransactionHash: Map<string, TransactionReceipt>,
  retryConfig?: RetryConfig
): Promise<CollectedRangeEvents> {
  stats.rangesQueried++;

  const rangeEvents = await queryVotingEventsForRange(voting, fromBlock, toBlock, stats, anomalies, retryConfig);
  const isValid = await validateCollectedRange(
    voting,
    fromBlock,
    toBlock,
    rangeEvents.commitEvents,
    rangeEvents.revealEvents,
    receiptByTransactionHash,
    transactionConcurrency,
    stats,
    anomalies,
    retryConfig
  );

  if (isValid) return rangeEvents;

  stats.validationFailures++;
  if (fromBlock >= toBlock) {
    stats.validationPassed = false;
    throw new EventCollectionValidationError(
      `VotingV2 event collection validation failed at minimum block range ${fromBlock}-${toBlock}`,
      stats,
      anomalies
    );
  }

  stats.splitCount++;
  const midBlock = Math.floor((fromBlock + toBlock) / 2);
  const leftEvents = await collectRangeWithValidation(
    voting,
    fromBlock,
    midBlock,
    transactionConcurrency,
    stats,
    anomalies,
    receiptByTransactionHash,
    retryConfig
  );
  const rightEvents = await collectRangeWithValidation(
    voting,
    midBlock + 1,
    toBlock,
    transactionConcurrency,
    stats,
    anomalies,
    receiptByTransactionHash,
    retryConfig
  );

  return {
    commitEvents: [...leftEvents.commitEvents, ...rightEvents.commitEvents],
    revealEvents: [...leftEvents.revealEvents, ...rightEvents.revealEvents],
  };
}

export async function collectVotingV2Events({
  voting,
  fromBlock,
  toBlock,
  maxBlockLookBack,
  transactionConcurrency,
  retryConfig,
}: Pick<
  CalculateVoterGasRebateV2Config,
  "voting" | "fromBlock" | "toBlock" | "maxBlockLookBack" | "transactionConcurrency" | "retryConfig"
>): Promise<CollectedVotingEvents> {
  const stats = createEventCollectionStats(maxBlockLookBack);
  const anomalies: RebateAnomaly[] = [];
  const receiptByTransactionHash = new Map<string, TransactionReceipt>();
  const rangeResults: CollectedRangeEvents[] = [];

  for (const [rangeFromBlock, rangeToBlock] of getBlockRanges(fromBlock, toBlock, maxBlockLookBack)) {
    rangeResults.push(
      await collectRangeWithValidation(
        voting,
        rangeFromBlock,
        rangeToBlock,
        transactionConcurrency,
        stats,
        anomalies,
        receiptByTransactionHash,
        retryConfig
      )
    );
  }

  const commitEvents = sortEventsByBlockAndLogIndex(rangeResults.flatMap((result) => result.commitEvents));
  const revealEvents = sortEventsByBlockAndLogIndex(rangeResults.flatMap((result) => result.revealEvents));

  stats.commitEventCount = commitEvents.length;
  stats.revealEventCount = revealEvents.length;
  stats.validationPassed = true;

  return {
    commitEvents,
    revealEvents,
    receiptByTransactionHash,
    eventCollectionStats: stats,
    anomalies,
  };
}

async function getTransactionsFromEvents(
  voting: VotingV2,
  events: Event[],
  transactionConcurrency: number,
  retryConfig?: RetryConfig,
  receiptByTransactionHash?: Map<string, TransactionReceipt>
): Promise<TransactionReceipt[]> {
  return await Bluebird.map(
    events,
    async (event) => {
      const cachedReceipt = receiptByTransactionHash?.get(event.transactionHash);
      if (cachedReceipt) return cachedReceipt;

      return await retryAsyncOperation(
        async () => await voting.provider.getTransactionReceipt(event.transactionHash),
        retryConfig?.retries,
        retryConfig?.delay
      );
    },
    { concurrency: transactionConcurrency }
  );
}

export async function calculateVoterGasRebateV2({
  voting,
  fromBlock,
  toBlock,
  minTokens,
  maxBlockLookBack,
  transactionConcurrency,
  maxPriorityFee,
  retryConfig,
}: CalculateVoterGasRebateV2Config): Promise<RebateComputationResult> {
  const eventCollection = await collectVotingV2Events({
    voting,
    fromBlock,
    toBlock,
    maxBlockLookBack,
    transactionConcurrency,
    retryConfig,
  });
  const { commitEvents, revealEvents, receiptByTransactionHash, eventCollectionStats } = eventCollection;
  const anomalies = [...eventCollection.anomalies];

  const eligibleRevealEvents = revealEvents.filter((event) => event.args.numTokens.gte(minTokens));
  const uniqueCommitEvents = getUniqueCommitEvents(commitEvents);
  const matchingCommitEvents = getMatchingCommitEvents(uniqueCommitEvents, eligibleRevealEvents);
  const missingCommitRevealEvents = eligibleRevealEvents.filter((event) => !uniqueCommitEvents.has(getVoteKey(event)));

  anomalies.push(
    ...missingCommitRevealEvents.map((event) => ({
      type: "reveal_missing_commit" as const,
      message: `Eligible reveal ${event.transactionHash} has no matching commit event in the collected block range`,
      fromBlock,
      toBlock,
      transactionHash: event.transactionHash,
      voter: event.args.voter,
    }))
  );

  const commitTransactions = await getTransactionsFromEvents(
    voting,
    matchingCommitEvents,
    transactionConcurrency,
    retryConfig,
    receiptByTransactionHash
  );
  const revealTransactions = await getTransactionsFromEvents(
    voting,
    eligibleRevealEvents,
    transactionConcurrency,
    retryConfig,
    receiptByTransactionHash
  );

  const transactionsToRefund = dedupeTransactionReceipts([...commitTransactions, ...revealTransactions]);
  const uniqueBlockNumbers = [...new Set(transactionsToRefund.map((tx) => tx.blockNumber))];
  const blockDataMap = new Map<number, BigNumber>();

  await Bluebird.map(
    uniqueBlockNumbers,
    async (blockNumber) => {
      const block = await retryAsyncOperation(
        async () => await voting.provider.getBlock(blockNumber),
        retryConfig?.retries,
        retryConfig?.delay
      );
      if (block.baseFeePerGas) blockDataMap.set(blockNumber, block.baseFeePerGas);
    },
    { concurrency: transactionConcurrency }
  );

  const shareholderPayoutWei: { [address: string]: BigNumber } = {};
  const transactionEvidence: RebateTransactionEvidence[] = [];

  for (const transaction of transactionsToRefund) {
    const baseFee = blockDataMap.get(transaction.blockNumber);
    let effectiveGasPriceForRebate: BigNumber;
    let actualPriorityFee: BigNumber | null = null;
    let cappedPriorityFee: BigNumber | null = null;

    if (baseFee) {
      actualPriorityFee = transaction.effectiveGasPrice.sub(baseFee);
      cappedPriorityFee = maxPriorityFee && actualPriorityFee.gt(maxPriorityFee) ? maxPriorityFee : actualPriorityFee;
      effectiveGasPriceForRebate = baseFee.add(cappedPriorityFee);
    } else {
      effectiveGasPriceForRebate = transaction.effectiveGasPrice;
    }

    const resultantRebate = transaction.gasUsed.mul(effectiveGasPriceForRebate);
    if (!shareholderPayoutWei[transaction.from]) shareholderPayoutWei[transaction.from] = BigNumber.from(0);
    shareholderPayoutWei[transaction.from] = shareholderPayoutWei[transaction.from].add(resultantRebate);

    transactionEvidence.push({
      transactionHash: transaction.transactionHash,
      from: transaction.from,
      blockNumber: transaction.blockNumber,
      gasUsed: transaction.gasUsed.toString(),
      effectiveGasPrice: transaction.effectiveGasPrice.toString(),
      baseFee: baseFee ? baseFee.toString() : null,
      actualPriorityFee: actualPriorityFee ? actualPriorityFee.toString() : null,
      cappedPriorityFee: cappedPriorityFee ? cappedPriorityFee.toString() : null,
      effectiveGasPriceForRebate: effectiveGasPriceForRebate.toString(),
      rebateWei: resultantRebate.toString(),
    });
  }

  const totalRebateWei = Object.values(shareholderPayoutWei).reduce((a, b) => a.add(b), BigNumber.from(0));

  return {
    votingContractAddress: voting.address,
    fromBlock,
    toBlock,
    minStakedTokens: minTokens,
    maxBlockLookBack,
    transactionConcurrency,
    maxPriorityFee,
    commitEvents,
    revealEvents,
    eligibleRevealEvents,
    matchingCommitEvents,
    transactionsToRefund,
    shareholderPayoutWei,
    totalRebateWei,
    transactionEvidence,
    eventCollectionStats,
    anomalies,
  };
}

function assertPlainObject(value: unknown, name: string): asserts value is { [key: string]: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CorrectionManifestValidationError(`${name} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CorrectionManifestValidationError(`${name} must be a non-empty string`);
  }
  return value;
}

function assertSafeInteger(value: unknown, name: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (minimum !== undefined && value < minimum)) {
    throw new CorrectionManifestValidationError(`${name} must be a safe integer`);
  }
  return value;
}

function normalizeAddress(value: unknown, name: string): string {
  const address = assertNonEmptyString(value, name);
  try {
    return utils.getAddress(address);
  } catch (error) {
    throw new CorrectionManifestValidationError(`${name} must be a valid Ethereum address`);
  }
}

function validateBlockRange(fromBlock: number, toBlock: number, name: string) {
  if (fromBlock > toBlock) {
    throw new CorrectionManifestValidationError(
      `${name} has invalid block range: fromBlock (${fromBlock}) > toBlock (${toBlock})`
    );
  }
}

function resolveInputPath(filePath: string, baseDir: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function expandScientificNotation(value: string): string {
  if (!/[eE]/.test(value)) return value;

  const [coefficient, exponentValue] = value.toLowerCase().split("e");
  const exponent = Number(exponentValue);
  if (!Number.isSafeInteger(exponent)) throw new Error(`Invalid decimal exponent: ${value}`);

  const [integerPart, fractionalPart = ""] = coefficient.split(".");
  const digits = `${integerPart}${fractionalPart}`.replace(/^0+(?=\d)/, "");
  const decimalIndex = integerPart.length + exponent;

  if (decimalIndex <= 0) return `0.${"0".repeat(Math.abs(decimalIndex))}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

export function parseEthDecimalToWei(value: number | string): BigNumber {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new CorrectionManifestValidationError("ETH amount must be a number or decimal string");
  }

  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
    throw new CorrectionManifestValidationError("ETH amount number must be finite and non-negative");
  }

  const rawDecimal = typeof value === "number" ? expandScientificNotation(value.toString()) : value.trim();
  if (rawDecimal.startsWith("-")) {
    throw new CorrectionManifestValidationError("ETH amount must be non-negative");
  }
  if (!/^\d+(\.\d+)?$/.test(rawDecimal)) {
    throw new CorrectionManifestValidationError(`ETH amount must be a decimal value: ${value}`);
  }

  const [integerPart, fractionalPart = ""] = rawDecimal.split(".");
  const extraFractionalDigits = fractionalPart.slice(18);
  if (extraFractionalDigits.length > 0 && /[1-9]/.test(extraFractionalDigits)) {
    throw new CorrectionManifestValidationError(`ETH amount has more than 18 decimal places: ${value}`);
  }

  const weiString = `${integerPart}${fractionalPart.padEnd(18, "0").slice(0, 18)}`.replace(/^0+(?=\d)/, "");
  return BigNumber.from(weiString || "0");
}

export function formatWeiToEthDecimalString(value: BigNumber): string {
  return utils.formatEther(value);
}

function parseWeiString(value: unknown, name: string): BigNumber {
  const rawValue = assertNonEmptyString(value, name);
  if (!/^-?\d+$/.test(rawValue)) {
    throw new CorrectionManifestValidationError(`${name} must be an integer wei string`);
  }
  return BigNumber.from(rawValue);
}

function validateDecimalString(value: unknown, name: string): string {
  const decimal = assertNonEmptyString(value, name);
  parseEthDecimalToWei(decimal);
  return decimal;
}

function validateGweiDecimalString(value: unknown, name: string): string | null {
  if (value === null) return null;
  const decimal = assertNonEmptyString(value, name);
  try {
    utils.parseUnits(decimal, "gwei");
  } catch (error) {
    throw new CorrectionManifestValidationError(`${name} must be a decimal gwei value`);
  }
  return decimal;
}

function normalizePayoutWei(shareholderPayout: {
  [address: string]: number | string;
}): { [address: string]: BigNumber } {
  return Object.entries(shareholderPayout).reduce((payoutWei: { [address: string]: BigNumber }, [address, amount]) => {
    const normalizedAddress = normalizeAddress(address, "shareholderPayout address");
    const amountWei = parseEthDecimalToWei(amount);
    payoutWei[normalizedAddress] = (payoutWei[normalizedAddress] || BigNumber.from(0)).add(amountWei);
    return payoutWei;
  }, {});
}

function normalizeRecomputedPayoutWei(shareholderPayoutWei: {
  [address: string]: BigNumber;
}): {
  [address: string]: BigNumber;
} {
  return Object.entries(shareholderPayoutWei).reduce(
    (payoutWei: { [address: string]: BigNumber }, [address, amount]) => {
      const normalizedAddress = normalizeAddress(address, "recomputed shareholder address");
      payoutWei[normalizedAddress] = (payoutWei[normalizedAddress] || BigNumber.from(0)).add(amount);
      return payoutWei;
    },
    {}
  );
}

function totalWei(payoutWei: { [address: string]: BigNumber }): BigNumber {
  return Object.values(payoutWei).reduce((total, amount) => total.add(amount), BigNumber.from(0));
}

function loadJsonFile(filePath: string, label: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new CorrectionManifestValidationError(`${label} not found: ${filePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new CorrectionManifestValidationError(`${label} is malformed JSON: ${filePath}`);
  }
}

function validatePaidRebateFile(
  rebateFile: unknown,
  rebateFilePath: string,
  entry: CorrectionManifestAuditEntry,
  expectedVotingContractAddress: string
): PaidRebateFile {
  assertPlainObject(rebateFile, `Paid rebate file ${rebateFilePath}`);

  const paidVotingContractAddress = normalizeAddress(
    rebateFile.votingContractAddress,
    `Paid rebate file ${rebateFilePath} votingContractAddress`
  );
  if (paidVotingContractAddress.toLowerCase() !== expectedVotingContractAddress.toLowerCase()) {
    throw new CorrectionManifestValidationError(
      `Paid rebate file ${rebateFilePath} uses non-VotingV2 contract ${paidVotingContractAddress}`
    );
  }

  const rebate = assertSafeInteger(rebateFile.rebate, `Paid rebate file ${rebateFilePath} rebate`, 0);
  const fromBlock = assertSafeInteger(rebateFile.fromBlock, `Paid rebate file ${rebateFilePath} fromBlock`, 0);
  const toBlock = assertSafeInteger(rebateFile.toBlock, `Paid rebate file ${rebateFilePath} toBlock`, 0);
  const countVoters = assertSafeInteger(rebateFile.countVoters, `Paid rebate file ${rebateFilePath} countVoters`, 0);
  validateBlockRange(fromBlock, toBlock, `Paid rebate file ${rebateFilePath}`);

  if (rebate !== entry.rebateNumber) {
    throw new CorrectionManifestValidationError(
      `Manifest rebateNumber ${entry.rebateNumber} does not match paid rebate file ${rebateFilePath} rebate ${rebate}`
    );
  }
  if (fromBlock !== entry.fromBlock || toBlock !== entry.toBlock) {
    throw new CorrectionManifestValidationError(
      `Manifest block range ${entry.fromBlock}-${entry.toBlock} does not match paid rebate file ${rebateFilePath} ` +
        `range ${fromBlock}-${toBlock}`
    );
  }

  if (typeof rebateFile.totalRebateAmount !== "number" && typeof rebateFile.totalRebateAmount !== "string") {
    throw new CorrectionManifestValidationError(`Paid rebate file ${rebateFilePath} totalRebateAmount is invalid`);
  }
  parseEthDecimalToWei(rebateFile.totalRebateAmount);

  assertPlainObject(rebateFile.shareholderPayout, `Paid rebate file ${rebateFilePath} shareholderPayout`);
  normalizePayoutWei(rebateFile.shareholderPayout as { [address: string]: number | string });

  return {
    votingContractAddress: paidVotingContractAddress,
    rebate,
    fromBlock,
    toBlock,
    countVoters,
    totalRebateAmount: rebateFile.totalRebateAmount as number | string,
    shareholderPayout: rebateFile.shareholderPayout as { [address: string]: number | string },
  };
}

function validateOutputPrefix(value: unknown): string {
  const outputPrefix = assertNonEmptyString(value, "manifest outputPrefix");
  if (!/^[A-Za-z0-9_.-]+$/.test(outputPrefix)) {
    throw new CorrectionManifestValidationError(
      "manifest outputPrefix may only contain letters, numbers, periods, underscores, and hyphens"
    );
  }
  return outputPrefix;
}

function validateCorrectionManifestAuditEntry(
  value: unknown,
  index: number,
  baseDir: string,
  votingContractAddress: string
): ValidatedCorrectionManifestAuditEntry {
  assertPlainObject(value, `manifest audits[${index}]`);

  const rebateFile = assertNonEmptyString(value.rebateFile, `manifest audits[${index}].rebateFile`);
  const rebateNumber = assertSafeInteger(value.rebateNumber, `manifest audits[${index}].rebateNumber`, 0);
  const fromBlock = assertSafeInteger(value.fromBlock, `manifest audits[${index}].fromBlock`, 0);
  const toBlock = assertSafeInteger(value.toBlock, `manifest audits[${index}].toBlock`, 0);
  validateBlockRange(fromBlock, toBlock, `manifest audits[${index}]`);

  const minStakedTokens = validateDecimalString(value.minStakedTokens, `manifest audits[${index}].minStakedTokens`);
  const maxPriorityFeeGwei = validateGweiDecimalString(
    value.maxPriorityFeeGwei,
    `manifest audits[${index}].maxPriorityFeeGwei`
  );
  const maxBlockLookBack = assertSafeInteger(value.maxBlockLookBack, `manifest audits[${index}].maxBlockLookBack`, 1);
  const transactionConcurrency = assertSafeInteger(
    value.transactionConcurrency,
    `manifest audits[${index}].transactionConcurrency`,
    1
  );
  const notes =
    value.notes === undefined ? undefined : assertNonEmptyString(value.notes, `manifest audits[${index}].notes`);
  const paidRebateFilePath = resolveInputPath(rebateFile, baseDir);

  const entry = {
    rebateFile,
    rebateNumber,
    fromBlock,
    toBlock,
    minStakedTokens,
    maxPriorityFeeGwei,
    maxBlockLookBack,
    transactionConcurrency,
    ...(notes ? { notes } : {}),
  };
  const paidRebate = validatePaidRebateFile(
    loadJsonFile(paidRebateFilePath, `Paid rebate file ${paidRebateFilePath}`),
    paidRebateFilePath,
    entry,
    votingContractAddress
  );

  return {
    ...entry,
    paidRebateFilePath,
    paidRebate,
    minStakedTokensWei: parseEthDecimalToWei(minStakedTokens).toString(),
    maxPriorityFeeWei: maxPriorityFeeGwei === null ? null : utils.parseUnits(maxPriorityFeeGwei, "gwei").toString(),
  };
}

function validateExpectedDeltas(value: unknown): CorrectionExpectedDelta[] {
  if (!Array.isArray(value)) {
    throw new CorrectionManifestValidationError("manifest expectedDeltas must be an array");
  }

  const seenExpectedDeltas = new Set<string>();
  return value.map((delta, index) => {
    assertPlainObject(delta, `manifest expectedDeltas[${index}]`);
    const rebateNumber = assertSafeInteger(delta.rebateNumber, `manifest expectedDeltas[${index}].rebateNumber`, 0);
    const address = normalizeAddress(delta.address, `manifest expectedDeltas[${index}].address`);
    const deltaWei = parseWeiString(delta.deltaWei, `manifest expectedDeltas[${index}].deltaWei`).toString();
    const expectedDeltaKey = `${rebateNumber}:${address.toLowerCase()}`;

    if (seenExpectedDeltas.has(expectedDeltaKey)) {
      throw new CorrectionManifestValidationError(
        `Duplicate expected delta for rebate ${rebateNumber} address ${address}`
      );
    }
    seenExpectedDeltas.add(expectedDeltaKey);

    return {
      rebateNumber,
      address,
      deltaWei,
    };
  });
}

function validateNoOverlappingAuditRanges(audits: ValidatedCorrectionManifestAuditEntry[]) {
  const sortedAudits = [...audits].sort((a, b) => {
    if (a.fromBlock !== b.fromBlock) return a.fromBlock - b.fromBlock;
    return a.toBlock - b.toBlock;
  });

  for (let index = 1; index < sortedAudits.length; index++) {
    const previous = sortedAudits[index - 1];
    const current = sortedAudits[index];
    if (current.fromBlock <= previous.toBlock) {
      throw new CorrectionManifestValidationError(
        `Manifest audit block ranges overlap: rebate ${previous.rebateNumber} ` +
          `${previous.fromBlock}-${previous.toBlock} and rebate ${current.rebateNumber} ` +
          `${current.fromBlock}-${current.toBlock}`
      );
    }
  }
}

function validateExpectedDeltasReferenceAudits(
  expectedDeltas: CorrectionExpectedDelta[],
  audits: ValidatedCorrectionManifestAuditEntry[]
) {
  const auditedRebateNumbers = new Set(audits.map((audit) => audit.rebateNumber));
  for (const expectedDelta of expectedDeltas) {
    if (!auditedRebateNumbers.has(expectedDelta.rebateNumber)) {
      throw new CorrectionManifestValidationError(
        `Expected delta references rebate ${expectedDelta.rebateNumber}, which is not in manifest audits`
      );
    }
  }
}

export function loadCorrectionManifest(
  manifestPath: string,
  options: { baseDir?: string; expectedVotingContractAddress?: string } = {}
): ValidatedCorrectionManifest {
  const absoluteManifestPath = path.resolve(manifestPath);
  const baseDir = options.baseDir ? path.resolve(options.baseDir) : process.cwd();
  const manifest = loadJsonFile(absoluteManifestPath, `Correction manifest ${absoluteManifestPath}`);
  assertPlainObject(manifest, "Correction manifest");

  if (manifest.version !== 1) {
    throw new CorrectionManifestValidationError("manifest version must be 1");
  }

  const name = assertNonEmptyString(manifest.name, "manifest name");
  const votingContractAddress = normalizeAddress(manifest.votingContractAddress, "manifest votingContractAddress");
  const expectedVotingContractAddress = options.expectedVotingContractAddress
    ? normalizeAddress(options.expectedVotingContractAddress, "expected VotingV2 contract address")
    : votingContractAddress;

  if (votingContractAddress.toLowerCase() !== expectedVotingContractAddress.toLowerCase()) {
    throw new CorrectionManifestValidationError(
      `Manifest uses non-VotingV2 contract ${votingContractAddress}; expected ${expectedVotingContractAddress}`
    );
  }

  const outputPrefix = validateOutputPrefix(manifest.outputPrefix);
  if (!Array.isArray(manifest.audits) || manifest.audits.length === 0) {
    throw new CorrectionManifestValidationError("manifest audits must be a non-empty array");
  }

  const audits = manifest.audits.map((audit, index) =>
    validateCorrectionManifestAuditEntry(audit, index, baseDir, votingContractAddress)
  );
  validateNoOverlappingAuditRanges(audits);

  const expectedDeltas = validateExpectedDeltas(manifest.expectedDeltas);
  validateExpectedDeltasReferenceAudits(expectedDeltas, audits);

  return {
    version: 1,
    name,
    votingContractAddress,
    outputPrefix,
    audits,
    expectedDeltas,
  };
}

export function diffPaidVersusRecomputedAmounts(
  paidPayoutWei: { [address: string]: BigNumber },
  recomputedPayoutWei: { [address: string]: BigNumber }
): CorrectionAddressDelta[] {
  const addresses = [...new Set([...Object.keys(paidPayoutWei), ...Object.keys(recomputedPayoutWei)])].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  return addresses.map((address) => {
    const paidWei = paidPayoutWei[address] || BigNumber.from(0);
    const recomputedWei = recomputedPayoutWei[address] || BigNumber.from(0);
    return {
      address,
      paidWei: paidWei.toString(),
      recomputedWei: recomputedWei.toString(),
      deltaWei: recomputedWei.sub(paidWei).toString(),
    };
  });
}

function splitCorrectionDeltas(
  deltas: CorrectionAddressDelta[]
): {
  positive: CorrectionAddressDelta[];
  zero: CorrectionAddressDelta[];
  negative: CorrectionAddressDelta[];
} {
  return {
    positive: deltas.filter((delta) => BigNumber.from(delta.deltaWei).gt(0)),
    zero: deltas.filter((delta) => BigNumber.from(delta.deltaWei).eq(0)),
    negative: deltas.filter((delta) => BigNumber.from(delta.deltaWei).lt(0)),
  };
}

function sumDeltaWei(deltas: CorrectionAddressDelta[]): BigNumber {
  return deltas.reduce((total, delta) => total.add(BigNumber.from(delta.deltaWei)), BigNumber.from(0));
}

export function getCorrectionArtifactPaths(outputDir: string, outputPrefix: string): CorrectionArtifactPaths {
  return {
    payoutPath: path.join(outputDir, `${outputPrefix}.json`),
    auditJsonPath: path.join(outputDir, `${outputPrefix}.audit.json`),
    auditMarkdownPath: path.join(outputDir, `${outputPrefix}.audit.md`),
  };
}

function assertCanWriteCorrectionArtifacts(paths: CorrectionArtifactPaths, allowOverwrite: boolean) {
  const existingOutputPaths = [paths.payoutPath, paths.auditJsonPath, paths.auditMarkdownPath].filter((outputPath) =>
    fs.existsSync(outputPath)
  );
  if (!allowOverwrite && existingOutputPaths.length > 0) {
    throw new Error(
      `Refusing to overwrite existing correction output(s): ${existingOutputPaths.join(", ")}. ` +
        "Set ALLOW_OVERWRITE=true to replace them."
    );
  }
}

function buildCorrectionPayoutJson(
  manifest: ValidatedCorrectionManifest,
  consolidatedPayoutWei: { [address: string]: BigNumber }
): CorrectionPayoutJson {
  const sortedAddresses = Object.keys(consolidatedPayoutWei).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
  const shareholderPayout = sortedAddresses.reduce((payout: { [address: string]: number }, address) => {
    payout[address] = parseFloat(formatWeiToEthDecimalString(consolidatedPayoutWei[address]));
    return payout;
  }, {});
  const totalRebateWei = totalWei(consolidatedPayoutWei);
  const fromBlock = Math.min(...manifest.audits.map((audit) => audit.fromBlock));
  const toBlock = Math.max(...manifest.audits.map((audit) => audit.toBlock));
  const rebate = Math.min(...manifest.audits.map((audit) => audit.rebateNumber));

  return {
    votingContractAddress: manifest.votingContractAddress,
    rebate,
    fromBlock,
    toBlock,
    countVoters: sortedAddresses.length,
    totalRebateAmount: parseFloat(formatWeiToEthDecimalString(totalRebateWei)),
    shareholderPayout,
  };
}

function getPositiveDeltaEvidence(
  result: RebateComputationResult,
  positiveDeltas: CorrectionAddressDelta[]
): RebateTransactionEvidence[] {
  const positiveAddresses = new Set(positiveDeltas.map((delta) => delta.address.toLowerCase()));
  return result.transactionEvidence.filter((evidence) => positiveAddresses.has(evidence.from.toLowerCase()));
}

function buildExpectedDeltaChecks(
  manifest: ValidatedCorrectionManifest,
  deltaByRebateAndAddress: Map<string, CorrectionAddressDelta>
): CorrectionExpectedDeltaCheck[] {
  return manifest.expectedDeltas.map((expectedDelta) => {
    const key = `${expectedDelta.rebateNumber}:${expectedDelta.address.toLowerCase()}`;
    const actualDelta = deltaByRebateAndAddress.get(key);
    const actualDeltaWei = actualDelta ? actualDelta.deltaWei : "0";
    return {
      rebateNumber: expectedDelta.rebateNumber,
      address: expectedDelta.address,
      expectedDeltaWei: expectedDelta.deltaWei,
      actualDeltaWei,
      passed: BigNumber.from(actualDeltaWei).eq(BigNumber.from(expectedDelta.deltaWei)),
    };
  });
}

function validateExpectedDeltaChecks(expectedDeltaChecks: CorrectionExpectedDeltaCheck[]) {
  const failedChecks = expectedDeltaChecks.filter((check) => !check.passed);
  if (failedChecks.length > 0) {
    throw new Error(
      "Expected delta mismatch: " +
        failedChecks
          .map(
            (check) =>
              `rebate ${check.rebateNumber} ${check.address} expected ${check.expectedDeltaWei} actual ${check.actualDeltaWei}`
          )
          .join("; ")
    );
  }
}

function getManifestHash(manifestPath: string): string {
  return createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
}

function formatCorrectionAuditMarkdown(report: CorrectionAuditReport): string {
  const auditedRebateLines = report.auditedRebates.flatMap((rebateReport) => [
    `### Rebate ${rebateReport.rebateNumber}`,
    "",
    `- Paid file: \`${rebateReport.rebateFile}\``,
    ...(rebateReport.notes ? [`- Notes: ${rebateReport.notes}`] : []),
    `- Block range: ${rebateReport.blockRange.fromBlock}-${rebateReport.blockRange.toBlock}`,
    `- Paid total: ${rebateReport.paid.totalRebateWei} wei (${rebateReport.paid.totalRebateEth} ETH)`,
    `- Recomputed total: ${rebateReport.recomputed.totalRebateWei} wei (${rebateReport.recomputed.totalRebateEth} ETH)`,
    `- Positive delta total: ${rebateReport.deltas.positiveTotalWei} wei (${rebateReport.deltas.positiveTotalEth} ETH)`,
    `- Negative delta total: ${rebateReport.deltas.negativeTotalWei} wei (${rebateReport.deltas.negativeTotalEth} ETH)`,
    `- Positive delta count: ${rebateReport.deltas.positive.length}`,
    `- Negative delta count: ${rebateReport.deltas.negative.length}`,
    `- Event validation passed: ${rebateReport.eventCollection.validationPassed}`,
    `- Retry count: ${rebateReport.eventCollection.retryCount}`,
    `- Split count: ${rebateReport.eventCollection.splitCount}`,
    `- Anomalies: ${rebateReport.anomalies.length}`,
    "",
  ]);
  const expectedDeltaLines =
    report.expectedDeltaChecks.length === 0
      ? ["- None"]
      : report.expectedDeltaChecks.map(
          (check) =>
            `- Rebate ${check.rebateNumber} ${check.address}: expected ${check.expectedDeltaWei}, actual ` +
            `${check.actualDeltaWei}, passed ${check.passed}`
        );
  const negativeDeltaLines = report.auditedRebates.flatMap((rebateReport) =>
    rebateReport.deltas.negative.map(
      (delta) => `- Rebate ${rebateReport.rebateNumber} ${delta.address}: ${delta.deltaWei} wei`
    )
  );

  return [
    `# VotingV2 Gas Rebate Correction Audit - ${report.manifestName}`,
    "",
    `Generated at: ${report.generatedAt}`,
    `Manifest: \`${report.manifestPath}\``,
    `Manifest SHA-256: \`${report.manifestHash}\``,
    `VotingV2 contract: \`${report.votingContractAddress}\``,
    `Custom node URL configured: ${report.customNodeUrlConfigured}`,
    "",
    "## Consolidated Top-Up",
    "",
    `- Voters: ${report.consolidatedTopUp.countVoters}`,
    `- Total: ${report.consolidatedTopUp.totalWei} wei (${report.consolidatedTopUp.totalEth} ETH)`,
    `- Payout JSON: \`${report.outputPaths.payoutPath}\``,
    "",
    "## Audited Rebates",
    "",
    ...auditedRebateLines,
    "## Expected Delta Checks",
    "",
    ...expectedDeltaLines,
    "",
    "## Negative Deltas",
    "",
    ...(negativeDeltaLines.length === 0 ? ["- None"] : negativeDeltaLines),
    "",
  ].join("\n");
}

export async function runVotingV2CorrectionAudit({
  manifestPath,
  voting,
  outputDir,
  expectedVotingContractAddress,
  baseDir,
  allowOverwrite = false,
  customNodeUrlConfigured = false,
  retryConfig,
  generatedAt,
  calculateRebate = calculateVoterGasRebateV2,
}: RunVotingV2CorrectionAuditOptions): Promise<WrittenCorrectionArtifacts> {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifest = loadCorrectionManifest(absoluteManifestPath, {
    baseDir,
    expectedVotingContractAddress,
  });
  const paths = getCorrectionArtifactPaths(path.resolve(outputDir), manifest.outputPrefix);
  assertCanWriteCorrectionArtifacts(paths, allowOverwrite);

  const deltaByRebateAndAddress = new Map<string, CorrectionAddressDelta>();
  const consolidatedPayoutWei: { [address: string]: BigNumber } = {};
  const auditedRebates: CorrectionAuditRebateReport[] = [];

  for (const entry of manifest.audits) {
    const minTokens = BigNumber.from(entry.minStakedTokensWei);
    const maxPriorityFee = entry.maxPriorityFeeWei === null ? null : BigNumber.from(entry.maxPriorityFeeWei);
    const result = await calculateRebate(
      {
        voting,
        fromBlock: entry.fromBlock,
        toBlock: entry.toBlock,
        minTokens,
        maxBlockLookBack: entry.maxBlockLookBack,
        transactionConcurrency: entry.transactionConcurrency,
        maxPriorityFee,
        retryConfig,
      },
      entry,
      manifest
    );

    if (result.votingContractAddress.toLowerCase() !== manifest.votingContractAddress.toLowerCase()) {
      throw new Error(
        `Recomputed rebate ${entry.rebateNumber} used unexpected voting contract ${result.votingContractAddress}`
      );
    }
    if (result.fromBlock !== entry.fromBlock || result.toBlock !== entry.toBlock) {
      throw new Error(`Recomputed rebate ${entry.rebateNumber} returned an unexpected block range`);
    }

    const paidPayoutWei = normalizePayoutWei(entry.paidRebate.shareholderPayout);
    const recomputedPayoutWei = normalizeRecomputedPayoutWei(result.shareholderPayoutWei);
    const paidTotalWei = totalWei(paidPayoutWei);
    const recomputedTotalWei = totalWei(recomputedPayoutWei);
    const allDeltas = diffPaidVersusRecomputedAmounts(paidPayoutWei, recomputedPayoutWei);
    const { positive, zero, negative } = splitCorrectionDeltas(allDeltas);
    const positiveTotalWei = sumDeltaWei(positive);
    const negativeTotalWei = sumDeltaWei(negative);

    for (const delta of allDeltas) {
      deltaByRebateAndAddress.set(`${entry.rebateNumber}:${delta.address.toLowerCase()}`, delta);
    }
    for (const delta of positive) {
      const deltaWei = BigNumber.from(delta.deltaWei);
      consolidatedPayoutWei[delta.address] = (consolidatedPayoutWei[delta.address] || BigNumber.from(0)).add(deltaWei);
    }

    auditedRebates.push({
      rebateNumber: entry.rebateNumber,
      rebateFile: entry.rebateFile,
      paidRebateFilePath: entry.paidRebateFilePath,
      ...(entry.notes ? { notes: entry.notes } : {}),
      blockRange: {
        fromBlock: entry.fromBlock,
        toBlock: entry.toBlock,
      },
      effectiveConfig: {
        minStakedTokens: entry.minStakedTokens,
        minStakedTokensWei: entry.minStakedTokensWei,
        maxPriorityFeeGwei: entry.maxPriorityFeeGwei,
        maxPriorityFeeWei: entry.maxPriorityFeeWei,
        maxBlockLookBack: entry.maxBlockLookBack,
        transactionConcurrency: entry.transactionConcurrency,
        maxRetries: retryConfig?.retries || null,
        retryDelay: retryConfig?.delay || null,
      },
      paid: {
        countVoters: Object.keys(paidPayoutWei).length,
        totalRebateWei: paidTotalWei.toString(),
        totalRebateEth: formatWeiToEthDecimalString(paidTotalWei),
      },
      recomputed: {
        countVoters: Object.keys(recomputedPayoutWei).length,
        totalRebateWei: recomputedTotalWei.toString(),
        totalRebateEth: formatWeiToEthDecimalString(recomputedTotalWei),
      },
      deltas: {
        positive,
        zero,
        negative,
        positiveTotalWei: positiveTotalWei.toString(),
        positiveTotalEth: formatWeiToEthDecimalString(positiveTotalWei),
        negativeTotalWei: negativeTotalWei.toString(),
        negativeTotalEth: formatWeiToEthDecimalString(negativeTotalWei),
      },
      eventCollection: {
        ...result.eventCollectionStats,
      },
      anomalies: result.anomalies,
      transactionEvidenceForPositiveDeltas: getPositiveDeltaEvidence(result, positive),
    });
  }

  const expectedDeltaChecks = buildExpectedDeltaChecks(manifest, deltaByRebateAndAddress);
  validateExpectedDeltaChecks(expectedDeltaChecks);

  const payout = buildCorrectionPayoutJson(manifest, consolidatedPayoutWei);
  const consolidatedPayoutWeiStrings = Object.keys(consolidatedPayoutWei)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .reduce((payoutWei: { [address: string]: string }, address) => {
      payoutWei[address] = consolidatedPayoutWei[address].toString();
      return payoutWei;
    }, {});
  const consolidatedTotalWei = totalWei(consolidatedPayoutWei);
  const negativeDeltaCount = auditedRebates.reduce(
    (count, rebateReport) => count + rebateReport.deltas.negative.length,
    0
  );
  const anomalyCount = auditedRebates.reduce((count, rebateReport) => count + rebateReport.anomalies.length, 0);
  const report: CorrectionAuditReport = {
    reportType: "VotingV2GasRebateCorrectionAudit",
    generatedAt: generatedAt || new Date().toISOString(),
    manifestPath: absoluteManifestPath,
    manifestHash: getManifestHash(absoluteManifestPath),
    manifestName: manifest.name,
    outputPrefix: manifest.outputPrefix,
    outputPaths: paths,
    votingContractAddress: manifest.votingContractAddress,
    customNodeUrlConfigured,
    validation: {
      passed: true,
      expectedDeltaChecksPassed: true,
      negativeDeltaCount,
      anomalyCount,
    },
    auditedRebates,
    expectedDeltaChecks,
    consolidatedTopUp: {
      countVoters: Object.keys(consolidatedPayoutWei).length,
      totalWei: consolidatedTotalWei.toString(),
      totalEth: formatWeiToEthDecimalString(consolidatedTotalWei),
      shareholderPayoutWei: consolidatedPayoutWeiStrings,
    },
  };

  fs.mkdirSync(path.resolve(outputDir), { recursive: true });
  fs.writeFileSync(paths.payoutPath, JSON.stringify(payout, null, 4));
  fs.writeFileSync(paths.auditJsonPath, JSON.stringify(report, null, 4));
  fs.writeFileSync(paths.auditMarkdownPath, formatCorrectionAuditMarkdown(report));

  return {
    ...paths,
    payout,
    report,
  };
}
