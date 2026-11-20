import { strict as assert } from "assert";
import { BigNumber, Contract, providers, utils } from "ethers";
import {
  getAbi,
  GovernorChildTunnelEthers,
  GovernorRootTunnelEthers,
  GovernorV2Ethers,
  ProposerV2Ethers,
  StoreEthers,
  ERC20Ethers,
} from "@uma/contracts-node";
import type { AdminProposalTransaction } from "../common/types";

// This is a single reviewed proposal. Do not override its payout or role-change parameters via environment variables.
export const ADDRESSES = {
  proposerWallet: "0x2bAaA41d155ad8a4126184950B31F50A1513cE25",
  proposer: "0x50efaC9619225d7fB4703C5872da978849B6E7cC",
  governor: "0x7b292034084A41B9D441B71b6E3557Edd0463fa8",
  votingToken: "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828",
  root: "0x4F490F4835B3693A8874aee87D7CC242c25DCCAf",
  child: "0xb4AeaD497FCbEAA3C37919032d42C29682f46376",
  store: "0xE58480CA74f1A819faFd777BEDED4E2D5629943d",
  token: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  recipient: "0xa0B6210f5B522b97bbcE9B8E617627105c0e3891",
  multisig: "0x6ee4D971142afadEa1828445124D6137080B4146",
} as const;
export const AMOUNT = utils.parseUnits("37875", 6);
export const EXPLANATION =
  `Refund 37,875 USDC.e from the Polygon Store to ${ADDRESSES.recipient} and transfer the Store withdrawer role ` +
  `to the RL Polygon multisig ${ADDRESSES.multisig}. Refund approved in Snapshot proposal ` +
  "0x5e036f2a5848ac5c3e1a966f526c3070c1d7b2963d2bc66b610c22dfe2df11d1.";

export const storeInterface = new utils.Interface(getAbi("Store"));
export const tokenInterface = new utils.Interface(getAbi("ERC20"));
export const rootInterface = new utils.Interface(getAbi("GovernorRootTunnel"));
export const childInterface = new utils.Interface(getAbi("GovernorChildTunnel"));

export function polygonCalls(): { to: string; data: string }[] {
  return [
    { to: ADDRESSES.store, data: storeInterface.encodeFunctionData("resetMember", [1, ADDRESSES.child]) },
    { to: ADDRESSES.store, data: storeInterface.encodeFunctionData("withdrawErc20", [ADDRESSES.token, AMOUNT]) },
    { to: ADDRESSES.token, data: tokenInterface.encodeFunctionData("transfer", [ADDRESSES.recipient, AMOUNT]) },
    { to: ADDRESSES.store, data: storeInterface.encodeFunctionData("resetMember", [1, ADDRESSES.multisig]) },
  ];
}

export function proposalTransactions(): AdminProposalTransaction[] {
  return polygonCalls().map(({ to, data }) => ({
    to: ADDRESSES.root,
    value: 0,
    data: rootInterface.encodeFunctionData("relayGovernance", [to, data]),
  }));
}

export function assertAddress(actual: string, expected: string, description: string): void {
  assert.equal(actual.toLowerCase(), expected.toLowerCase(), description);
}

export function proposalId(): number {
  const value = process.env.PROPOSAL_ID;
  assert(value && /^\d+$/.test(value), "PROPOSAL_ID must be explicitly set to a nonnegative integer");
  const id = Number(value);
  assert(Number.isSafeInteger(id), "PROPOSAL_ID is too large");
  return id;
}

export interface Contracts {
  governor: GovernorV2Ethers;
  proposer: ProposerV2Ethers;
  votingToken: ERC20Ethers;
  root: GovernorRootTunnelEthers;
  child: GovernorChildTunnelEthers;
  store: StoreEthers;
  token: ERC20Ethers;
}

export async function connect(l1: providers.Provider, polygon: providers.Provider): Promise<Contracts> {
  assert.equal((await l1.getNetwork()).chainId, 1, "Expected Ethereum mainnet or chain-1 fork");
  assert.equal((await polygon.getNetwork()).chainId, 137, "Expected Polygon or chain-137 fork");
  const contracts = {
    governor: new Contract(ADDRESSES.governor, getAbi("GovernorV2"), l1) as GovernorV2Ethers,
    proposer: new Contract(ADDRESSES.proposer, getAbi("ProposerV2"), l1) as ProposerV2Ethers,
    votingToken: new Contract(ADDRESSES.votingToken, getAbi("ERC20"), l1) as ERC20Ethers,
    root: new Contract(ADDRESSES.root, rootInterface, l1) as GovernorRootTunnelEthers,
    child: new Contract(ADDRESSES.child, childInterface, polygon) as GovernorChildTunnelEthers,
    store: new Contract(ADDRESSES.store, storeInterface, polygon) as StoreEthers,
    token: new Contract(ADDRESSES.token, tokenInterface, polygon) as ERC20Ethers,
  };
  assertAddress(await contracts.root.owner(), ADDRESSES.governor, "Unexpected root tunnel owner");
  assertAddress(await contracts.root.fxChildTunnel(), ADDRESSES.child, "Unexpected child tunnel");
  assertAddress(await contracts.child.fxRootTunnel(), ADDRESSES.root, "Unexpected root tunnel");
  assertAddress(await contracts.store.getMember(0), ADDRESSES.child, "Unexpected Store owner");
  assert.equal(await contracts.token.decimals(), 6, "Unexpected USDC.e decimals");
  const safe = new Contract(
    ADDRESSES.multisig,
    ["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"],
    polygon
  );
  const threshold: BigNumber = await safe.getThreshold();
  const owners: string[] = await safe.getOwners();
  assert(threshold.gt(0) && threshold.lte(owners.length), "Invalid destination Safe configuration");
  return contracts;
}

export async function assertStartingState({ store, token }: Contracts): Promise<void> {
  assertAddress(await store.getMember(1), ADDRESSES.proposerWallet, "Unexpected initial Store withdrawer");
  assert((await token.balanceOf(ADDRESSES.store)).gte(AMOUNT), "Insufficient Store USDC.e balance");
}

export function assertProposal(transactions: AdminProposalTransaction[], ancillaryData: string): void {
  const expected = proposalTransactions();
  assert.equal(transactions.length, expected.length, "Proposal must contain exactly four transactions");
  assert.equal(ancillaryData, utils.hexlify(utils.toUtf8Bytes(EXPLANATION)), "Unexpected proposal explanation");
  transactions.forEach((tx, i) => {
    assertAddress(tx.to, expected[i].to, `Unexpected proposal target at index ${i}`);
    assert(BigNumber.from(tx.value).isZero(), `Unexpected ETH value at index ${i}`);
    assert.equal(utils.hexlify(tx.data), expected[i].data, `Unexpected proposal calldata at index ${i}`);
  });
}

// Verify actual Polygon receipts, not balances that can change independently after the payment.
export async function verifyPolygonReceipts(
  contracts: Contracts,
  receipts: providers.TransactionReceipt[]
): Promise<void> {
  assert(receipts.length > 0, "No Polygon receipts supplied");
  assert.equal(new Set(receipts.map((r) => r.transactionHash)).size, receipts.length, "Duplicate Polygon receipts");
  receipts.forEach((r) => assert.equal(r.status, 1, `Polygon transaction failed: ${r.transactionHash}`));
  const logs = receipts.flatMap((r) => r.logs).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const executions = logs.filter(
    (log) =>
      log.address.toLowerCase() === ADDRESSES.child.toLowerCase() &&
      log.topics[0] === childInterface.getEventTopic("ExecutedGovernanceTransaction")
  );
  const expected = polygonCalls();
  assert.equal(executions.length, expected.length, "Expected all four Polygon governance executions");
  executions.forEach((log, i) => {
    const event = childInterface.parseLog(log);
    assertAddress(event.args.to, expected[i].to, `Unexpected Polygon target at index ${i}`);
    assert.equal(event.args.data, expected[i].data, `Unexpected Polygon calldata at index ${i}`);
  });
  for (const [from, to] of [
    [ADDRESSES.store, ADDRESSES.child],
    [ADDRESSES.child, ADDRESSES.recipient],
  ]) {
    const transfers = logs
      .filter(
        (log) =>
          log.address.toLowerCase() === ADDRESSES.token.toLowerCase() &&
          log.topics[0] === tokenInterface.getEventTopic("Transfer")
      )
      .map((log) => tokenInterface.parseLog(log).args)
      .filter((args) => args.from.toLowerCase() === from.toLowerCase() && args.to.toLowerCase() === to.toLowerCase());
    assert.equal(transfers.length, 1, `Expected exactly one USDC.e transfer from ${from} to ${to}`);
    assert(transfers[0].value.eq(AMOUNT), "Incorrect refund amount");
  }
  assertAddress(await contracts.store.getMember(0), ADDRESSES.child, "Store owner changed");
  assertAddress(await contracts.store.getMember(1), ADDRESSES.multisig, "Multisig is not the sole withdrawer");
}
