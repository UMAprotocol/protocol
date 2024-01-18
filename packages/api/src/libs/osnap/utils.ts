import assert from "assert";
import { utils } from "ethers";
import { Json } from "../../types";
import type { GnosisSafe, OsnapPluginData } from "./interfaces";
import { simulateTenderlyTx, TenderlySimulationParams } from "@uma/common";
import { getAddress, OptimisticGovernorEthers__factory } from "@uma/contracts-node";

export async function simulateOsnapProposal(space: OsnapPluginData): Promise<Json> {
  const { safe } = space;
  assert(safe, "Requires a safe");
  assert(safe.transactions.length > 0, "Cannot simulate empty transactions");

  const ooAddress = await getAddress("OptimisticOracleV3", Number(safe.network));

  const simParams = mapOsnapSafeToTenderlySim(safe, ooAddress);
  // we are passing the result straight to express, so we are casting this as json. this is fully
  // compatible with json type since all values are primitives.
  return ((await simulateTenderlyTx(simParams)) as unknown) as Json;
}

// Creates Tenderly simulation parameters for oSnap proposal execution with required state overrides:
// - OptimisticGovernor knows of proposalHash pointing to non-zero asserionId in the assertionIds mapping;
// - OptimisticOracleV3 has the Assertion with the above assertionId marked as settled.
export function mapOsnapSafeToTenderlySim(safe: GnosisSafe, ooAddress: string): TenderlySimulationParams {
  const transactions = safe.transactions.map((tx) => {
    const [to, operation, value, data] = tx.formatted;
    return { to, operation, data, value };
  });

  // Calculate proposalHash from proposed transaction contents.
  const ogInterface = OptimisticGovernorEthers__factory.createInterface();
  const proposalHash = utils.keccak256(
    utils.defaultAbiCoder.encode(ogInterface.getFunction("executeProposal").inputs, [transactions])
  );

  // assertionIds mapping pointer is at slot 110 in the OptimisticGovernor contract.
  const assertionIdsSlot = utils.keccak256(utils.defaultAbiCoder.encode(["bytes32", "uint256"], [proposalHash, 110]));

  // assertionId needs to be the same non-zero value in both OptimisticGovernor and OptimisticOracleV3.
  const assertionId = "0x1";

  // assertions mapping pointer is at slot 4 in the OptimisticOracleV3 contract. We need to override settled property
  // that is 28 bytes offset at slot 2 within the Assertion struct.
  const assertionSettledSlot =
    "0x" +
    (
      BigInt(
        utils.keccak256(utils.defaultAbiCoder.encode(["bytes32", "uint256"], [utils.hexZeroPad(assertionId, 32), 4]))
      ) + 2n
    ).toString(16);
  const assertionSettledOffset = 28;
  const assertionSettledValue = "0x1"; // Represents settled as true.

  return {
    chainId: Number(safe.network),
    to: safe.moduleAddress,
    input: ogInterface.encodeFunctionData("executeProposal", [transactions]),
    stateOverrides: [
      { address: safe.moduleAddress, slot: assertionIdsSlot, value: assertionId },
      { address: ooAddress, slot: assertionSettledSlot, offset: assertionSettledOffset, value: assertionSettledValue },
    ],
  };
}
