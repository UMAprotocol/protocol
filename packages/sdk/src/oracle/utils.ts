import { State, RequestState, Flag } from "./types/state";
import { Read } from "./store";

export function initFlags() {
  return {
    [Flag.MissingRequest]: true,
    [Flag.MissingUser]: true,
    [Flag.WrongChain]: true,
    [Flag.InvalidStateForPropose]: true,
    [Flag.InvalidStateForDispute]: true,
    [Flag.InsufficientBalance]: true,
    [Flag.InsufficientApproval]: true,
    [Flag.ProposalInProgress]: true,
    [Flag.ApprovalInProgress]: true,
    [Flag.DisputeInProgress]: true,
  };
}

export function getFlags(state: State) {
  const read = new Read(state);
  const flags = initFlags();

  try {
    if (read.userAddress()) {
      flags[Flag.MissingUser] = false;
    } else {
      flags[Flag.MissingUser] = true;
    }
  } catch (err) {
    // ignore
  }

  try {
    if (read.inputRequest()) {
      flags[Flag.MissingRequest] = false;
    } else {
      flags[Flag.MissingRequest] = true;
    }
  } catch (err) {
    // ignore
  }

  try {
    if (read.userChainId() != read.requestChainId()) {
      flags[Flag.WrongChain] = true;
    } else {
      flags[Flag.WrongChain] = false;
    }
  } catch (err) {
    // ignore
  }

  try {
    if (read.request()?.state !== RequestState.Requested) {
      flags[Flag.InvalidStateForPropose] = true;
    } else {
      flags[Flag.InvalidStateForPropose] = false;
    }
    if (read.request()?.state !== RequestState.Proposed) {
      flags[Flag.InvalidStateForDispute] = true;
    } else {
      flags[Flag.InvalidStateForDispute] = false;
    }
  } catch (err) {
    // ignore
  }

  try {
    const totalBond = read.request().bond.add(read.request().finalFee);

    if (read.userCollateralBalance().lt(totalBond)) {
      flags[Flag.InsufficientBalance] = true;
    } else {
      flags[Flag.InsufficientBalance] = false;
    }
    if (read.userCollateralAllowance().lt(totalBond)) {
      flags[Flag.InsufficientApproval] = true;
    } else {
      flags[Flag.InsufficientApproval] = false;
    }
  } catch (err) {
    // ignore
  }

  // TODO: add logic for these
  flags[Flag.ProposalInProgress] = false;
  flags[Flag.DisputeInProgress] = false;
  flags[Flag.ApprovalInProgress] = false;

  return flags;
}
