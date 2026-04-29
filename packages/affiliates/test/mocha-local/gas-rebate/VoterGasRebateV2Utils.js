require("ts-node/register/transpile-only");

const { assert } = require("chai");
const { BigNumber, utils } = require("ethers");
const { createHash } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildMonthlyAuditReport,
  calculateVoterGasRebateV2,
  getCorrectionArtifactPaths,
  formatMonthlyAuditMarkdown,
  getMonthlyAuditReportPaths,
  loadCorrectionManifest,
  parseEthDecimalToWei,
  runVotingV2CorrectionAudit,
  writeMonthlyAuditReports,
} = require("../../../gas-rebate/voterGasRebateV2Utils");

const votingAddress = "0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac";
const commitTopic = "0x0000000000000000000000000000000000000000000000000000000000000001";
const revealTopic = "0x0000000000000000000000000000000000000000000000000000000000000002";
const voter = "0x0000000000000000000000000000000000000001";
const identifier = "0x5445535400000000000000000000000000000000000000000000000000000000";
const ancillaryData = "0x";
const correctionPositiveVoter = utils.getAddress("0x00000000000000000000000000000000000000e1");
const correctionZeroVoter = utils.getAddress("0x00000000000000000000000000000000000000e2");
const correctionNegativeVoter = utils.getAddress("0x00000000000000000000000000000000000000e3");
const correctionNewVoter = utils.getAddress("0x00000000000000000000000000000000000000e4");

function makeVoteArgs(overrides = {}) {
  return {
    voter,
    roundId: BigNumber.from(1),
    identifier,
    time: BigNumber.from(123),
    ancillaryData,
    numTokens: BigNumber.from(1000),
    ...overrides,
  };
}

function makeEvent(blockNumber, logIndex, transactionHash, args = makeVoteArgs()) {
  return {
    blockNumber,
    logIndex,
    transactionHash,
    args,
  };
}

function makeReceipt(transactionHash, from, blockNumber, gasUsed, effectiveGasPrice, eventTypes = []) {
  return {
    transactionHash,
    from,
    blockNumber,
    gasUsed: BigNumber.from(gasUsed),
    effectiveGasPrice: BigNumber.from(effectiveGasPrice),
    logs: eventTypes.map((eventType) => ({
      address: votingAddress,
      topics: [eventType === "commit" ? commitTopic : revealTopic],
    })),
  };
}

function makeVoting({ commitEvents, revealEvents, receipts, blocks, queryFilter }) {
  const defaultQueryFilter = async (filter, fromBlock, toBlock) => {
    const events = filter.eventName === "VoteCommitted" ? commitEvents : revealEvents;
    return events.filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
  };

  return {
    address: votingAddress,
    interface: {
      getEventTopic: (eventName) => (eventName === "VoteCommitted" ? commitTopic : revealTopic),
    },
    filters: {
      VoteCommitted: () => ({ eventName: "VoteCommitted", topics: [commitTopic] }),
      VoteRevealed: () => ({ eventName: "VoteRevealed", topics: [revealTopic] }),
    },
    queryFilter: queryFilter || defaultQueryFilter,
    provider: {
      getTransactionReceipt: async (transactionHash) => receipts[transactionHash],
      getBlock: async (blockNumber) => blocks[blockNumber],
    },
  };
}

function makeMonthlyAuditConfig(overrides = {}) {
  return {
    minStakedTokens: "1000.0",
    minStakedTokensWei: "1000000000000000000000",
    maxPriorityFeeGwei: "0.001",
    maxPriorityFeeWei: "1000000",
    maxBlockLookBack: 250,
    transactionConcurrency: 100,
    maxRetries: 10,
    retryDelay: 1000,
    overrideFromBlockConfigured: true,
    overrideToBlockConfigured: true,
    customNodeUrlConfigured: true,
    ...overrides,
  };
}

function makeMonthlyAuditResult(overrides = {}) {
  return {
    votingContractAddress: votingAddress,
    fromBlock: 24558868,
    toBlock: 24781026,
    minStakedTokens: BigNumber.from("1000000000000000000000"),
    maxBlockLookBack: 250,
    transactionConcurrency: 100,
    maxPriorityFee: BigNumber.from("1000000"),
    commitEvents: [makeEvent(1, 1, "0xcommit1"), makeEvent(2, 2, "0xcommit2")],
    revealEvents: [makeEvent(3, 3, "0xreveal1"), makeEvent(4, 4, "0xreveal2"), makeEvent(5, 5, "0xreveal3")],
    eligibleRevealEvents: [makeEvent(3, 3, "0xreveal1"), makeEvent(4, 4, "0xreveal2")],
    matchingCommitEvents: [makeEvent(1, 1, "0xcommit1")],
    transactionsToRefund: [
      makeReceipt("0xcommit1", voter, 1, "100", "200", ["commit"]),
      makeReceipt("0xreveal1", voter, 3, "50", "200", ["reveal"]),
    ],
    shareholderPayoutWei: {
      [voter]: BigNumber.from("1234567890000000000"),
    },
    totalRebateWei: BigNumber.from("1234567890000000000"),
    transactionEvidence: [
      {
        transactionHash: "0xcommit1",
        from: voter,
        blockNumber: 1,
        gasUsed: "100",
        effectiveGasPrice: "200",
        baseFee: "100",
        actualPriorityFee: "100",
        cappedPriorityFee: "100",
        effectiveGasPriceForRebate: "200",
        rebateWei: "20000",
      },
    ],
    eventCollectionStats: {
      maxBlockLookBack: 250,
      minBlockLookBack: 1,
      rangesQueried: 889,
      queryAttempts: 1778,
      retryCount: 1,
      splitCount: 2,
      validationFailures: 2,
      providerErrors: 1,
      receiptValidationCount: 345,
      commitEventCount: 2,
      revealEventCount: 3,
      validationPassed: true,
    },
    anomalies: [
      {
        type: "reveal_missing_commit",
        message: "Eligible reveal has no matching commit",
        fromBlock: 24558868,
        toBlock: 24781026,
        transactionHash: "0xreveal2",
        voter,
      },
    ],
    ...overrides,
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function makePaidRebate(overrides = {}) {
  return {
    votingContractAddress: votingAddress,
    rebate: 66,
    fromBlock: 100,
    toBlock: 200,
    countVoters: 3,
    totalRebateAmount: 6,
    shareholderPayout: {
      [correctionPositiveVoter]: 1,
      [correctionZeroVoter]: 2,
      [correctionNegativeVoter]: 3,
    },
    ...overrides,
  };
}

function makeCorrectionManifest(overrides = {}, auditOverrides = {}) {
  return {
    version: 1,
    name: "Test correction",
    votingContractAddress: votingAddress,
    outputPrefix: "Correction_Test",
    audits: [
      {
        rebateFile: "paid/Rebate_66.json",
        rebateNumber: 66,
        fromBlock: 100,
        toBlock: 200,
        minStakedTokens: "1000",
        maxPriorityFeeGwei: "0.001",
        maxBlockLookBack: 250,
        transactionConcurrency: 10,
        ...auditOverrides,
      },
    ],
    expectedDeltas: [],
    ...overrides,
  };
}

function sumBigNumbers(values) {
  return Object.values(values).reduce((total, amount) => total.add(amount), BigNumber.from(0));
}

function makeCorrectionComputationResult(shareholderPayoutWei, overrides = {}) {
  return makeMonthlyAuditResult({
    votingContractAddress: votingAddress,
    fromBlock: 100,
    toBlock: 200,
    shareholderPayoutWei,
    totalRebateWei: sumBigNumbers(shareholderPayoutWei),
    transactionEvidence: [
      {
        transactionHash: "0xpositive",
        from: correctionPositiveVoter,
        blockNumber: 101,
        gasUsed: "1",
        effectiveGasPrice: "1",
        baseFee: "1",
        actualPriorityFee: "0",
        cappedPriorityFee: "0",
        effectiveGasPriceForRebate: "1",
        rebateWei: "1",
      },
      {
        transactionHash: "0xnew",
        from: correctionNewVoter,
        blockNumber: 102,
        gasUsed: "1",
        effectiveGasPrice: "1",
        baseFee: "1",
        actualPriorityFee: "0",
        cappedPriorityFee: "0",
        effectiveGasPriceForRebate: "1",
        rebateWei: "1",
      },
      {
        transactionHash: "0xnegative",
        from: correctionNegativeVoter,
        blockNumber: 103,
        gasUsed: "1",
        effectiveGasPrice: "1",
        baseFee: "1",
        actualPriorityFee: "0",
        cappedPriorityFee: "0",
        effectiveGasPriceForRebate: "1",
        rebateWei: "1",
      },
    ],
    anomalies: [],
    ...overrides,
  });
}

describe("VoterGasRebateV2 utils", function () {
  it("uses deterministic event ordering before commit dedupe and returns exact wei totals", async function () {
    const recipient = "0x00000000000000000000000000000000000000a1";
    const earlyCommit = makeEvent(5, 1, "0xcommit");
    const lateCommit = makeEvent(10, 2, "0xlate");
    const reveal = makeEvent(12, 3, "0xreveal");
    const voting = makeVoting({
      commitEvents: [lateCommit, earlyCommit],
      revealEvents: [reveal],
      receipts: {
        "0xcommit": makeReceipt("0xcommit", recipient, 5, 10, 150, ["commit"]),
        "0xlate": makeReceipt("0xlate", recipient, 10, 1000, 150, ["commit"]),
        "0xreveal": makeReceipt("0xreveal", recipient, 12, 5, 110, ["reveal"]),
      },
      blocks: {
        5: { baseFeePerGas: BigNumber.from(100) },
        12: { baseFeePerGas: BigNumber.from(100) },
      },
    });

    const result = await calculateVoterGasRebateV2({
      voting,
      fromBlock: 1,
      toBlock: 20,
      minTokens: BigNumber.from(500),
      maxBlockLookBack: 100,
      transactionConcurrency: 2,
      maxPriorityFee: BigNumber.from(20),
    });

    assert.equal(result.matchingCommitEvents.length, 1);
    assert.equal(result.matchingCommitEvents[0].transactionHash, "0xcommit");
    assert.deepEqual(
      result.transactionsToRefund.map((transaction) => transaction.transactionHash),
      ["0xcommit", "0xreveal"]
    );
    assert.equal(result.shareholderPayoutWei[recipient].toString(), "1750");
    assert.equal(result.totalRebateWei.toString(), "1750");
    assert.deepEqual(
      result.transactionEvidence.map((transaction) => transaction.rebateWei),
      ["1200", "550"]
    );
  });

  it("dedupes receipts by transaction hash before calculating rebates", async function () {
    const recipient = "0x00000000000000000000000000000000000000b1";
    const commit = makeEvent(5, 1, "0xshared");
    const reveal = makeEvent(6, 2, "0xshared");
    const voting = makeVoting({
      commitEvents: [commit],
      revealEvents: [reveal],
      receipts: {
        "0xshared": makeReceipt("0xshared", recipient, 6, 7, 150, ["commit", "reveal"]),
      },
      blocks: {
        6: { baseFeePerGas: BigNumber.from(100) },
      },
    });

    const result = await calculateVoterGasRebateV2({
      voting,
      fromBlock: 1,
      toBlock: 20,
      minTokens: BigNumber.from(500),
      maxBlockLookBack: 100,
      transactionConcurrency: 2,
      maxPriorityFee: null,
    });

    assert.equal(result.transactionsToRefund.length, 1);
    assert.equal(result.shareholderPayoutWei[recipient].toString(), "1050");
    assert.equal(result.totalRebateWei.toString(), "1050");
  });

  it("splits and retries when receipt validation catches silently truncated events", async function () {
    const recipient = "0x00000000000000000000000000000000000000c1";
    const commit = makeEvent(2, 1, "0xshared");
    const reveal = makeEvent(2, 2, "0xshared");
    let truncatedRevealQueries = 0;
    const queryFilter = async (filter, fromBlock, toBlock) => {
      const events = filter.eventName === "VoteCommitted" ? [commit] : [reveal];
      if (filter.eventName === "VoteRevealed" && fromBlock === 1 && toBlock === 4) {
        truncatedRevealQueries++;
        return [];
      }
      return events.filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
    };
    const voting = makeVoting({
      commitEvents: [commit],
      revealEvents: [reveal],
      receipts: {
        "0xshared": makeReceipt("0xshared", recipient, 2, 7, 150, ["commit", "reveal"]),
      },
      blocks: {
        2: { baseFeePerGas: BigNumber.from(100) },
      },
      queryFilter,
    });

    const result = await calculateVoterGasRebateV2({
      voting,
      fromBlock: 1,
      toBlock: 4,
      minTokens: BigNumber.from(500),
      maxBlockLookBack: 4,
      transactionConcurrency: 2,
      maxPriorityFee: null,
    });

    assert.equal(truncatedRevealQueries, 1);
    assert.equal(result.eventCollectionStats.validationPassed, true);
    assert.equal(result.eventCollectionStats.validationFailures, 1);
    assert.equal(result.eventCollectionStats.splitCount, 1);
    assert.equal(result.commitEvents.length, 1);
    assert.equal(result.revealEvents.length, 1);
    assert.isTrue(result.anomalies.some((anomaly) => anomaly.type === "receipt_event_count_mismatch"));
    assert.equal(result.transactionsToRefund.length, 1);
    assert.equal(result.shareholderPayoutWei[recipient].toString(), "1050");
  });

  it("fails closed when event truncation persists at the minimum block range", async function () {
    const recipient = "0x00000000000000000000000000000000000000d1";
    const commit = makeEvent(1, 1, "0xtruncated");
    const reveal = makeEvent(1, 2, "0xtruncated");
    const queryFilter = async (filter, fromBlock, toBlock) => {
      const events = filter.eventName === "VoteCommitted" ? [commit] : [reveal];
      if (filter.eventName === "VoteRevealed") return [];
      return events.filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
    };
    const voting = makeVoting({
      commitEvents: [commit],
      revealEvents: [reveal],
      receipts: {
        "0xtruncated": makeReceipt("0xtruncated", recipient, 1, 7, 150, ["commit", "reveal"]),
      },
      blocks: {
        1: { baseFeePerGas: BigNumber.from(100) },
      },
      queryFilter,
    });

    try {
      await calculateVoterGasRebateV2({
        voting,
        fromBlock: 1,
        toBlock: 1,
        minTokens: BigNumber.from(500),
        maxBlockLookBack: 1,
        transactionConcurrency: 2,
        maxPriorityFee: null,
      });
      assert.fail("Expected event collection validation to fail");
    } catch (error) {
      assert.equal(error.name, "EventCollectionValidationError");
      assert.equal(error.eventCollectionStats.validationPassed, false);
      assert.equal(error.eventCollectionStats.validationFailures, 1);
      assert.isTrue(error.anomalies.some((anomaly) => anomaly.type === "receipt_event_count_mismatch"));
    }
  });

  it("builds monthly audit reports with required counts, config, validation, and exact wei totals", function () {
    const rpcUrl = "https://rpc.example.invalid/secret-key";
    const report = buildMonthlyAuditReport(makeMonthlyAuditResult(), {
      outputRebateFilePath: "/tmp/Rebate_66.json",
      rebateNumber: 66,
      generatedAt: "2026-04-01T00:00:00.000Z",
      config: makeMonthlyAuditConfig(),
    });

    assert.equal(report.reportType, "VotingV2MonthlyGasRebateAudit");
    assert.equal(report.outputRebateFilePath, "/tmp/Rebate_66.json");
    assert.equal(report.votingContractAddress, votingAddress);
    assert.deepEqual(report.blockRange, { fromBlock: 24558868, toBlock: 24781026 });
    assert.deepEqual(report.counts, {
      commitEvents: 2,
      revealEvents: 3,
      eligibleRevealEvents: 2,
      matchedCommitEvents: 1,
      transactions: 2,
      voters: 1,
    });
    assert.equal(report.payout.totalRebateWei, "1234567890000000000");
    assert.equal(report.payout.totalRebateEth, "1.23456789");
    assert.equal(report.eventCollection.maxBlockLookBack, 250);
    assert.equal(report.eventCollection.retryCount, 1);
    assert.equal(report.eventCollection.splitCount, 2);
    assert.equal(report.validation.passed, true);
    assert.equal(report.validation.anomalyCount, 1);
    assert.equal(report.transactionEvidence[0].transactionHash, "0xcommit1");
    assert.equal(report.effectiveConfig.customNodeUrlConfigured, true);
    assert.notProperty(report.effectiveConfig, "customNodeUrl");
    assert.notInclude(JSON.stringify(report), rpcUrl);
  });

  it("formats concise monthly audit Markdown from the JSON report object", function () {
    const markdown = formatMonthlyAuditMarkdown(
      buildMonthlyAuditReport(makeMonthlyAuditResult(), {
        outputRebateFilePath: "/tmp/Rebate_66.json",
        rebateNumber: 66,
        generatedAt: "2026-04-01T00:00:00.000Z",
        config: makeMonthlyAuditConfig(),
      })
    );

    assert.include(markdown, "# VotingV2 Monthly Gas Rebate Audit - Rebate 66");
    assert.include(markdown, "Output rebate file: `/tmp/Rebate_66.json`");
    assert.include(markdown, "- Eligible reveal events: 2");
    assert.include(markdown, "- Matched commit events: 1");
    assert.include(markdown, "- Total payout: 1234567890000000000 wei (1.23456789 ETH)");
    assert.include(markdown, "- Validation passed: true");
    assert.include(markdown, "- Retry count: 1");
    assert.include(markdown, "- Split count: 2");
    assert.include(markdown, "- Custom node URL configured: true");
    assert.notInclude(markdown, "secret-key");
  });

  it("writes monthly audit JSON and Markdown next to the rebate file", function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voter-gas-rebate-v2-audit-"));
    try {
      const outputRebateFilePath = path.join(tempDir, "Rebate_66.json");
      const paths = getMonthlyAuditReportPaths(outputRebateFilePath);
      const written = writeMonthlyAuditReports(makeMonthlyAuditResult(), {
        outputRebateFilePath,
        rebateNumber: 66,
        generatedAt: "2026-04-01T00:00:00.000Z",
        config: makeMonthlyAuditConfig(),
      });

      assert.deepEqual(written.jsonPath, paths.jsonPath);
      assert.deepEqual(written.markdownPath, paths.markdownPath);
      assert.equal(path.basename(written.jsonPath), "Rebate_66.audit.json");
      assert.equal(path.basename(written.markdownPath), "Rebate_66.audit.md");
      assert.isTrue(fs.existsSync(written.jsonPath));
      assert.isTrue(fs.existsSync(written.markdownPath));

      const jsonReport = JSON.parse(fs.readFileSync(written.jsonPath, "utf8"));
      const markdownReport = fs.readFileSync(written.markdownPath, "utf8");
      assert.equal(jsonReport.payout.totalRebateWei, "1234567890000000000");
      assert.include(markdownReport, "VotingV2 Monthly Gas Rebate Audit");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("parses paid ETH decimals to exact wei", function () {
    assert.equal(parseEthDecimalToWei("0.007088051537280779").toString(), "7088051537280779");
    assert.equal(parseEthDecimalToWei(1e-7).toString(), "100000000000");
  });

  it("fails correction manifest validation for missing, malformed, and invalid inputs", function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voter-gas-rebate-v2-correction-validation-"));
    try {
      assert.throws(
        () => loadCorrectionManifest(path.join(tempDir, "missing.json"), { baseDir: tempDir }),
        /Correction manifest .* not found/
      );

      const malformedManifestPath = path.join(tempDir, "malformed.json");
      fs.writeFileSync(malformedManifestPath, "{");
      assert.throws(() => loadCorrectionManifest(malformedManifestPath, { baseDir: tempDir }), /malformed JSON/);

      const paidPath = path.join(tempDir, "paid/Rebate_66.json");
      const manifestPath = path.join(tempDir, "manifest.json");
      writeJson(paidPath, makePaidRebate());

      writeJson(
        manifestPath,
        makeCorrectionManifest({
          votingContractAddress: "0x0000000000000000000000000000000000000999",
        })
      );
      assert.throws(
        () =>
          loadCorrectionManifest(manifestPath, {
            baseDir: tempDir,
            expectedVotingContractAddress: votingAddress,
          }),
        /non-VotingV2/
      );

      writeJson(manifestPath, makeCorrectionManifest({}, { fromBlock: 201, toBlock: 200 }));
      assert.throws(() => loadCorrectionManifest(manifestPath, { baseDir: tempDir }), /invalid block range/);

      writeJson(manifestPath, makeCorrectionManifest({}, { rebateFile: "paid/Does_Not_Exist.json" }));
      assert.throws(() => loadCorrectionManifest(manifestPath, { baseDir: tempDir }), /Paid rebate file .* not found/);

      writeJson(paidPath, { ...makePaidRebate(), shareholderPayout: undefined });
      writeJson(manifestPath, makeCorrectionManifest());
      assert.throws(
        () => loadCorrectionManifest(manifestPath, { baseDir: tempDir }),
        /shareholderPayout must be an object/
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails correction manifests with overlapping audit block ranges", function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voter-gas-rebate-v2-correction-overlap-"));
    try {
      writeJson(path.join(tempDir, "paid/Rebate_66.json"), makePaidRebate());
      writeJson(
        path.join(tempDir, "paid/Rebate_67.json"),
        makePaidRebate({
          rebate: 67,
          fromBlock: 200,
          toBlock: 300,
        })
      );
      const manifestPath = path.join(tempDir, "manifest.json");
      const manifest = makeCorrectionManifest({
        audits: [
          makeCorrectionManifest().audits[0],
          {
            ...makeCorrectionManifest().audits[0],
            rebateFile: "paid/Rebate_67.json",
            rebateNumber: 67,
            fromBlock: 200,
            toBlock: 300,
          },
        ],
      });
      writeJson(manifestPath, manifest);

      assert.throws(() => loadCorrectionManifest(manifestPath, { baseDir: tempDir }), /block ranges overlap/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("consolidates positive correction deltas and reports zero and negative deltas separately", async function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voter-gas-rebate-v2-correction-run-"));
    try {
      const manifestPath = path.join(tempDir, "manifest.json");
      const outputDir = path.join(tempDir, "out");
      writeJson(path.join(tempDir, "paid/Rebate_66.json"), makePaidRebate());
      writeJson(
        manifestPath,
        makeCorrectionManifest({
          expectedDeltas: [
            {
              rebateNumber: 66,
              address: correctionPositiveVoter,
              deltaWei: "500000000000000000",
            },
            {
              rebateNumber: 66,
              address: correctionNegativeVoter,
              deltaWei: "-2000000000000000000",
            },
          ],
        })
      );

      const recomputedPayoutWei = {
        [correctionPositiveVoter]: BigNumber.from("1500000000000000000"),
        [correctionZeroVoter]: BigNumber.from("2000000000000000000"),
        [correctionNegativeVoter]: BigNumber.from("1000000000000000000"),
        [correctionNewVoter]: BigNumber.from("250000000000000000"),
      };
      const written = await runVotingV2CorrectionAudit({
        manifestPath,
        voting: { address: votingAddress },
        outputDir,
        baseDir: tempDir,
        generatedAt: "2026-04-01T00:00:00.000Z",
        customNodeUrlConfigured: true,
        calculateRebate: async (config) => {
          assert.equal(config.fromBlock, 100);
          assert.equal(config.toBlock, 200);
          assert.equal(config.minTokens.toString(), "1000000000000000000000");
          assert.equal(config.maxPriorityFee.toString(), "1000000");
          assert.equal(config.maxBlockLookBack, 250);
          assert.equal(config.transactionConcurrency, 10);
          return makeCorrectionComputationResult(recomputedPayoutWei);
        },
      });

      assert.isTrue(fs.existsSync(written.payoutPath));
      assert.isTrue(fs.existsSync(written.auditJsonPath));
      assert.isTrue(fs.existsSync(written.auditMarkdownPath));
      assert.equal(written.payout.countVoters, 2);
      assert.equal(written.payout.totalRebateAmount, 0.75);
      assert.deepEqual(written.payout.shareholderPayout, {
        [correctionPositiveVoter]: 0.5,
        [correctionNewVoter]: 0.25,
      });
      assert.notProperty(written.payout.shareholderPayout, correctionNegativeVoter);
      assert.equal(written.report.consolidatedTopUp.totalWei, "750000000000000000");
      assert.equal(written.report.auditedRebates[0].deltas.positive.length, 2);
      assert.equal(written.report.auditedRebates[0].deltas.zero.length, 1);
      assert.equal(written.report.auditedRebates[0].deltas.negative.length, 1);
      assert.equal(written.report.auditedRebates[0].deltas.negative[0].address, correctionNegativeVoter);
      assert.equal(written.report.auditedRebates[0].deltas.negative[0].deltaWei, "-2000000000000000000");
      assert.deepEqual(
        written.report.auditedRebates[0].transactionEvidenceForPositiveDeltas.map(
          (evidence) => evidence.transactionHash
        ),
        ["0xpositive", "0xnew"]
      );
      assert.isTrue(written.report.expectedDeltaChecks.every((check) => check.passed));
      assert.equal(written.report.customNodeUrlConfigured, true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails exact expected-delta mismatches before writing correction outputs", async function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voter-gas-rebate-v2-correction-expected-"));
    try {
      const manifestPath = path.join(tempDir, "manifest.json");
      const outputDir = path.join(tempDir, "out");
      writeJson(path.join(tempDir, "paid/Rebate_66.json"), makePaidRebate());
      writeJson(
        manifestPath,
        makeCorrectionManifest({
          expectedDeltas: [
            {
              rebateNumber: 66,
              address: correctionPositiveVoter,
              deltaWei: "1",
            },
          ],
        })
      );
      const paths = getCorrectionArtifactPaths(outputDir, "Correction_Test");
      const recomputedPayoutWei = {
        [correctionPositiveVoter]: BigNumber.from("1500000000000000000"),
        [correctionZeroVoter]: BigNumber.from("2000000000000000000"),
        [correctionNegativeVoter]: BigNumber.from("3000000000000000000"),
      };

      try {
        await runVotingV2CorrectionAudit({
          manifestPath,
          voting: { address: votingAddress },
          outputDir,
          baseDir: tempDir,
          calculateRebate: async () => makeCorrectionComputationResult(recomputedPayoutWei),
        });
        assert.fail("Expected exact delta validation to fail");
      } catch (error) {
        assert.match(error.message, /Expected delta mismatch/);
      }

      assert.isFalse(fs.existsSync(paths.payoutPath));
      assert.isFalse(fs.existsSync(paths.auditJsonPath));
      assert.isFalse(fs.existsSync(paths.auditMarkdownPath));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite existing correction outputs unless explicitly allowed", async function () {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "voter-gas-rebate-v2-correction-overwrite-"));
    try {
      const manifestPath = path.join(tempDir, "manifest.json");
      const outputDir = path.join(tempDir, "out");
      writeJson(path.join(tempDir, "paid/Rebate_66.json"), makePaidRebate());
      writeJson(manifestPath, makeCorrectionManifest());
      const paths = getCorrectionArtifactPaths(outputDir, "Correction_Test");
      writeJson(paths.payoutPath, { existing: true });

      let calculatorCalled = false;
      try {
        await runVotingV2CorrectionAudit({
          manifestPath,
          voting: { address: votingAddress },
          outputDir,
          baseDir: tempDir,
          calculateRebate: async () => {
            calculatorCalled = true;
            return makeCorrectionComputationResult({});
          },
        });
        assert.fail("Expected overwrite protection to fail");
      } catch (error) {
        assert.match(error.message, /Refusing to overwrite/);
      }

      assert.equal(calculatorCalled, false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loads the committed March 2026 Rebate 66 correction manifest", function () {
    const affiliatesDir = path.resolve(__dirname, "../../..");
    const manifestPath = path.join(affiliatesDir, "gas-rebate/corrections/Rebate_66_Correction_Manifest.json");
    const manifest = loadCorrectionManifest(manifestPath, {
      baseDir: affiliatesDir,
      expectedVotingContractAddress: votingAddress,
    });

    assert.equal(manifest.name, "March 2026 Rebate 66 VotingV2 correction");
    assert.equal(manifest.outputPrefix, "Correction_Rebate_66");
    assert.equal(manifest.votingContractAddress, votingAddress);
    assert.lengthOf(manifest.audits, 1);
    assert.include(manifest.audits[0], {
      rebateFile: "gas-rebate/rebates/Rebate_66.json",
      rebateNumber: 66,
      fromBlock: 24558868,
      toBlock: 24781026,
      minStakedTokens: "1000",
      maxPriorityFeeGwei: "0.001",
      maxBlockLookBack: 250,
      transactionConcurrency: 100,
    });
    assert.equal(manifest.audits[0].paidRebate.countVoters, 634);
    assert.equal(manifest.audits[0].paidRebate.totalRebateAmount, 2.0729797831799184);
    assert.deepEqual(
      manifest.expectedDeltas.map((delta) => ({
        rebateNumber: delta.rebateNumber,
        address: delta.address,
        deltaWei: delta.deltaWei,
      })),
      [
        {
          rebateNumber: 66,
          address: utils.getAddress("0xf20737e48160a87dc9d1b26d8b63c796d2f1ea91"),
          deltaWei: "7088051537280779",
        },
        {
          rebateNumber: 66,
          address: utils.getAddress("0x2a9437de0ccd4fd7b7d98831213acedefc7a1092"),
          deltaWei: "1902006430166225",
        },
      ]
    );
  });

  it("loads the committed Phase 6 Rebate 65-66 correction manifest with per-rebate policy parameters", function () {
    const affiliatesDir = path.resolve(__dirname, "../../..");
    const manifestPath = path.join(affiliatesDir, "gas-rebate/corrections/Rebates_65_66_Correction_Manifest.json");
    const manifest = loadCorrectionManifest(manifestPath, {
      baseDir: affiliatesDir,
      expectedVotingContractAddress: votingAddress,
    });

    assert.equal(manifest.name, "March and February 2026 Rebate 65-66 VotingV2 correction audit");
    assert.equal(manifest.outputPrefix, "Correction_Rebates_65_66");
    assert.lengthOf(manifest.audits, 2);
    assert.deepEqual(
      manifest.audits.map((audit) => ({
        rebateFile: audit.rebateFile,
        rebateNumber: audit.rebateNumber,
        fromBlock: audit.fromBlock,
        toBlock: audit.toBlock,
        minStakedTokens: audit.minStakedTokens,
        maxPriorityFeeGwei: audit.maxPriorityFeeGwei,
        maxBlockLookBack: audit.maxBlockLookBack,
        transactionConcurrency: audit.transactionConcurrency,
      })),
      [
        {
          rebateFile: "gas-rebate/rebates/Rebate_66.json",
          rebateNumber: 66,
          fromBlock: 24558868,
          toBlock: 24781026,
          minStakedTokens: "1000",
          maxPriorityFeeGwei: "0.001",
          maxBlockLookBack: 250,
          transactionConcurrency: 100,
        },
        {
          rebateFile: "gas-rebate/rebates/Rebate_65.json",
          rebateNumber: 65,
          fromBlock: 24358293,
          toBlock: 24558867,
          minStakedTokens: "1000",
          maxPriorityFeeGwei: "0.001",
          maxBlockLookBack: 250,
          transactionConcurrency: 100,
        },
      ]
    );
    assert.include(manifest.audits[1].notes, "backward audit stop point");
    assert.deepEqual(
      manifest.expectedDeltas.map((delta) => delta.rebateNumber),
      [66, 66]
    );
  });

  it("keeps committed Rebate 66 correction artifacts reviewable without committed audit JSON", function () {
    const affiliatesDir = path.resolve(__dirname, "../../..");
    const outputDir = path.join(affiliatesDir, "gas-rebate/corrections");
    const paths = getCorrectionArtifactPaths(outputDir, "Correction_Rebate_66");

    assert.isTrue(fs.existsSync(paths.payoutPath));
    assert.isTrue(fs.existsSync(paths.auditMarkdownPath));

    const payout = JSON.parse(fs.readFileSync(paths.payoutPath, "utf8"));
    const markdown = fs.readFileSync(paths.auditMarkdownPath, "utf8");

    assert.equal(payout.votingContractAddress, votingAddress);
    assert.equal(payout.rebate, 66);
    assert.equal(payout.fromBlock, 24558868);
    assert.equal(payout.toBlock, 24781026);
    assert.equal(payout.countVoters, 585);
    assert.equal(Object.keys(payout.shareholderPayout).length, payout.countVoters);

    for (const expected of [
      {
        address: utils.getAddress("0xf20737e48160a87dc9d1b26d8b63c796d2f1ea91"),
        deltaWei: "7088051537280779",
        deltaEth: 0.007088051537280779,
      },
      {
        address: utils.getAddress("0x2a9437de0ccd4fd7b7d98831213acedefc7a1092"),
        deltaWei: "1902006430166225",
        deltaEth: 0.001902006430166225,
      },
    ]) {
      assert.equal(payout.shareholderPayout[expected.address], expected.deltaEth);
      assert.include(markdown, `${expected.address}: expected ${expected.deltaWei}, actual ${expected.deltaWei}`);
      assert.include(markdown, "passed true");
    }

    assert.include(markdown, "# VotingV2 Gas Rebate Correction Audit - March 2026 Rebate 66 VotingV2 correction");
    assert.include(markdown, "- Total: 1095766860809837881 wei (1.095766860809837881 ETH)");
    assert.include(markdown, "- Voters: 585");
    assert.include(markdown, "- Positive delta count: 585");
    assert.include(markdown, "- Negative delta count: 0");
    assert.include(markdown, "- Event validation passed: true");
  });

  it("keeps committed Phase 6 Rebate 65-66 correction artifacts reviewable without committed audit JSON", function () {
    const affiliatesDir = path.resolve(__dirname, "../../..");
    const outputDir = path.join(affiliatesDir, "gas-rebate/corrections");
    const manifestPath = path.join(outputDir, "Rebates_65_66_Correction_Manifest.json");
    const paths = getCorrectionArtifactPaths(outputDir, "Correction_Rebates_65_66");

    assert.isTrue(fs.existsSync(paths.payoutPath));
    assert.isTrue(fs.existsSync(paths.auditMarkdownPath));

    const payout = JSON.parse(fs.readFileSync(paths.payoutPath, "utf8"));
    const markdown = fs.readFileSync(paths.auditMarkdownPath, "utf8");
    const manifestHash = createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");

    assert.equal(payout.votingContractAddress, votingAddress);
    assert.equal(payout.rebate, 65);
    assert.equal(payout.fromBlock, 24358293);
    assert.equal(payout.toBlock, 24781026);
    assert.equal(payout.countVoters, 591);
    assert.equal(Object.keys(payout.shareholderPayout).length, payout.countVoters);
    assert.include(markdown, "# VotingV2 Gas Rebate Correction Audit - March and February 2026");
    assert.include(markdown, `Manifest SHA-256: \`${manifestHash}\``);
    assert.include(markdown, "### Rebate 66");
    assert.include(markdown, "### Rebate 65");
    assert.include(markdown, "- Notes: February 2026 backward audit stop point");
    assert.include(markdown, "- Positive delta total: 58 wei (0.000000000000000058 ETH)");
    assert.include(markdown, "- Negative delta total: -52 wei (-0.000000000000000052 ETH)");
    assert.include(markdown, "- Split count: 0");
    assert.include(markdown, "- Total: 1095766860809837939 wei (1.095766860809837939 ETH)");
  });

  it("documents the Phase 7 runbook and review checklist without concrete RPC URLs", function () {
    const affiliatesDir = path.resolve(__dirname, "../../..");
    const readme = fs.readFileSync(path.join(affiliatesDir, "gas-rebate/README.md"), "utf8");

    for (const requiredText of [
      "Safe Chunk Size and Validation",
      "`MAX_BLOCK_LOOK_BACK=250` is the safe default chunk size",
      "CUSTOM_NODE_URL=\"<mainnet-rpc-url>\"",
      "March 2026 Rebate 66 Rerun",
      "Correction/audit mode is VotingV2-only",
      "Historical `Rebate_*.json` files are immutable",
      "Correction Manifest Schema",
      "March 2026 Correction Audit",
      "Overpayments are not clawed back by this workflow",
      "Artifact Review Checklist",
      "PR Checklist",
      "No secrets committed",
      "Expected deltas pass",
      "Validation passed",
      "Generated payout total equals audit summary total",
      "Historical rebates unchanged",
    ]) {
      assert.include(readme, requiredText);
    }

    assert.notMatch(readme, /CUSTOM_NODE_URL=["']?https?:\/\//);
    assert.notInclude(readme, "secret-key");
  });
});
