import { State } from "./types/state";
import { Read } from "./store";

export enum RequestState {
  Invalid = 0, // Never requested.
  Requested, // Requested, no other actions taken.
  Proposed, // Proposed, but not expired or disputed yet.
  Expired, // Proposed, not disputed, past liveness.
  Disputed, // Disputed, but no DVM price returned yet.
  Resolved, // Disputed and DVM price is available.
  Settled, // Final price has been set in the contract (can get here from Expired or Resolved).
}

export enum ProposalFlags {
  WrongChain = 0,
  InvalidContractState,
  InsufficientBalance,
  InsufficientApproval,
  TransactionInProgress,
}
export function previewProposal(state: State) {
  const read = new Read(state);
  const flags = [false, false, false, false, false];
  if (read.userChainId() != read.requestChainId()) {
    flags[ProposalFlags.WrongChain] = true;
  }
  if (read.request()?.state !== RequestState.Requested) {
    flags[ProposalFlags.InvalidContractState] = true;
  }
  const totalBond = read.request().bond.add(read.request().finalFee);

  if (read.userCollateralBalance().lt(totalBond)) {
    flags[ProposalFlags.InsufficientBalance] = true;
  }
  if (read.userCollateralAllowance().lt(totalBond)) {
    flags[ProposalFlags.InsufficientApproval] = true;
  }
  return flags;
}
