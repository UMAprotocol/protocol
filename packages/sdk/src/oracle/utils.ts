import { State, RequestState, Flag, Flags } from "./types/state";
import { ContextType } from "./types/statemachine";
import { Read } from "./store";

export function initFlags(): Flags {
  return {
    [Flag.MissingRequest]: false,
    [Flag.MissingUser]: false,
    [Flag.WrongChain]: false,
    [Flag.InProposeState]: false,
    [Flag.InDisputeState]: false,
    [Flag.InsufficientBalance]: false,
    [Flag.InsufficientApproval]: false,
    [Flag.ProposalInProgress]: false,
    [Flag.ApprovalInProgress]: false,
    [Flag.DisputeInProgress]: false,
    [Flag.ChainChangeInProgress]: false,
  };
}

export function getFlags(state: State): Record<Flag, boolean> {
  const read = new Read(state);
  const flags = initFlags();

  try {
    read.userAddress();
    flags[Flag.MissingUser] = false;
  } catch (err) {
    flags[Flag.MissingUser] = true;
  }

  try {
    read.inputRequest();
    flags[Flag.MissingRequest] = false;
  } catch (err) {
    flags[Flag.MissingRequest] = true;
  }

  try {
    flags[Flag.WrongChain] = read.userChainId() !== read.requestChainId();
  } catch (err) {
    flags[Flag.WrongChain] = false;
  }

  try {
    flags[Flag.InProposeState] = read.request()?.state === RequestState.Requested;
  } catch (err) {
    flags[Flag.InProposeState] = false;
  }

  try {
    flags[Flag.InDisputeState] = read.request()?.state === RequestState.Proposed;
  } catch (err) {
    flags[Flag.InDisputeState] = false;
  }

  try {
    const totalBond = read.request().bond.add(read.request().finalFee);
    flags[Flag.InsufficientBalance] = read.userCollateralBalance().lt(totalBond);
    flags[Flag.InsufficientApproval] = read.userCollateralAllowance().lt(totalBond);
  } catch (err) {
    // ignore
  }

  try {
    // get all active commands
    const commands = read.filterCommands({ done: false, user: read.userAddress() });
    // go through each command, look at the type and if it exists, we know a tx for this user is in progress
    commands.forEach((command) => {
      if (!flags[Flag.ProposalInProgress] && command.type === ContextType.proposePrice) {
        flags[Flag.ProposalInProgress] = true;
      }
      if (!flags[Flag.DisputeInProgress] && command.type === ContextType.disputePrice) {
        flags[Flag.DisputeInProgress] = true;
      }
      if (!flags[Flag.ApprovalInProgress] && command.type === ContextType.approve) {
        flags[Flag.ApprovalInProgress] = true;
      }
      if (!flags[Flag.ChainChangeInProgress] && command.type === ContextType.switchOrAddChain) {
        flags[Flag.ChainChangeInProgress] = true;
      }
    });
  } catch (err) {
    // ignore
  }

  return flags;
}
