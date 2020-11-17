/* eslint-disable no-unused-vars */
const { Balances, History, SharedAttributions } = require("./models");
const assert = require("assert");
const { decodeAttribution } = require("./contracts");

// keeps snapshots of all attributions to affiliates keyed by user
function AttributionHistory() {
  // stores complete balances for all events
  const attributions = SharedAttributions();
  // stores snapshots we can lookup by block
  const history = History();
  let lastBlockNumber;

  // this probably needs to be re-thought to take into
  // consideration token amounts as well as collateral
  const Handlers = ({ affiliate, user }) => {
    return {
      create(collateralAmount, numTokens) {
        attributions.attribute(user, affiliate, collateralAmount);
      },
      deposit(collateralAmount) {
        attributions.attribute(user, affiliate, collateralAmount);
      },
      depositTo(sponsor, collateralAmount) {
        attributions.attribute(user, affiliate, collateralAmount);
      },
      transferPositionPassedRequest(newSponsorAddress) {
        attributions.attribute(newSponsorAddress, affiliate);
      }
    };
  };

  function handleEvent({ user, affiliate }, { name, args = [] }) {
    assert(affiliate, "requires affiliate address");
    assert(user, "requires user address");
    const handlers = Handlers({ user, affiliate });
    assert(handlers[name], "No handler for event: " + name);
    return handlers[name](...args);
  }

  // event is a decoded transaction
  function handleTransaction(blockNumber, event) {
    assert(blockNumber, "requires blockNumber");
    if (lastBlockNumber == null) {
      lastBlockNumber = blockNumber;
    } else if (lastBlockNumber < blockNumber) {
      history.insert({
        blockNumber: lastBlockNumber,
        attributions: attributions.snapshot()
      });
      lastBlockNumber = blockNumber;
    }
    // both of these things arent stored in tx data
    const affiliate = decodeAttribution(event.input);
    const user = event.fromAddress;
    handleEvent({ user, affiliate }, event);
  }

  return {
    attributions,
    history,
    handleEvent,
    handleTransaction
  };
}

function EmpBalancesHistory() {
  // stores complete balances for all events
  const balances = EmpBalances();
  // stores snapshots we can lookup by block
  const history = History();
  let lastBlockNumber;
  let lastBlockTimestamp;

  // takes a snapshot of balances if the next event falls on a new block
  function handleEvent(blockNumber, event) {
    assert(blockNumber, "requires blockNumber");
    if (lastBlockNumber == null) {
      lastBlockNumber = blockNumber;
      lastBlockTimestamp = event.blockTimestamp;
    } else if (lastBlockNumber < blockNumber) {
      history.insert({
        blockNumber: lastBlockNumber,
        blockTimestamp: event.blockTimestamp,
        tokens: balances.tokens.snapshot(),
        collateral: balances.collateral.snapshot()
      });
      lastBlockNumber = blockNumber;
      lastBlockTimestamp = event.blockTimestamp;
    }
    balances.handleEvent(event);
  }

  // function to snapshot the final balance
  function finalize() {
    if (history.has(lastBlockNumber)) return;
    history.insert({
      blockNumber: lastBlockNumber,
      blockTimestamp: lastBlockTimestamp,
      tokens: balances.tokens.snapshot(),
      collateral: balances.collateral.snapshot()
    });
  }

  return {
    finalize,
    balances,
    history,
    handleEvent
  };
}

function EmpBalances(handlers = {}, { collateral, tokens } = {}) {
  // we need to allow negative balances on emps which have expired. Settlement may cause a sponsor or a non
  // sponsor if they settle with tokens they bought from third party causing them to burn more than they minted.
  // If not enabled expired emps may calculate larger totals overall than in actuality.
  collateral = collateral || Balances({ allowNegative: true });
  tokens = tokens || Balances({ allowNegative: true });

  handlers = {
    RequestTransferPosition(oldSponsor) {
      // nothing
    },
    RequestTransferPositionExecuted(oldSponsor, newSponsor) {
      const collateralBalance = collateral.get(oldSponsor);
      collateral.set(oldSponsor, "0");
      collateral.set(newSponsor, collateralBalance.toString());

      const tokenBalance = tokens.get(oldSponsor);
      tokens.set(oldSponsor, "0");
      tokens.set(newSponsor, tokenBalance.toString());
    },
    RequestTransferPositionCanceled(oldSponsor) {
      // nothing
    },
    Deposit(sponsor, collateralAmount) {
      collateral.add(sponsor, collateralAmount.toString());
    },
    Withdrawal(sponsor, collateralAmount) {
      collateral.sub(sponsor, collateralAmount.toString());
    },
    RequestWithdrawal(sponsor, collateralAmount) {
      // nothing
    },
    RequestWithdrawalExecuted(sponsor, collateralAmount) {
      collateral.sub(sponsor, collateralAmount.toString());
    },
    RequestWithdrawalCanceled(sponsor, collateralAmount) {
      // nothing
    },
    PositionCreated(sponsor, collateralAmount, tokenAmount) {
      collateral.add(sponsor, collateralAmount.toString());
      tokens.add(sponsor, tokenAmount.toString());
    },
    NewSponsor(sponsor) {
      // nothing
    },
    EndedSponsorPosition(sponsor) {
      // nothing
    },
    Redeem(sponsor, collateralAmount, tokenAmount) {
      collateral.sub(sponsor, collateralAmount.toString());
      tokens.sub(sponsor, tokenAmount).toString();
    },
    ContractExpired(caller) {
      // nothing
    },
    // looking at the emp code, i think anyone can call this even if they never had a position
    // this means balances may not exist or may go below 0. we should just catch those errors and ignore
    SettleExpiredPosition(caller, collateralReturned, tokensBurned) {
      collateral.sub(caller, collateralReturned.toString());
      tokens.sub(caller, tokensBurned.toString());
    },
    LiquidationCreated(
      sponsor,
      liquidator,
      liquidationId,
      tokensOutstanding,
      lockedCollateral,
      liquidatedCollateral,
      liquidationTime
    ) {
      collateral.sub(sponsor, liquidatedCollateral.toString());
      tokens.sub(sponsor, tokensOutstanding.toString());
    },
    LiquidationWithdrawn(caller, originalExpirationTimestamp, shutdownTimestamp) {
      // nothing
    },
    LiquidationDisputed(caller, originalExpirationTimestamp, shutdownTimestamp) {
      // nothing
    },
    FinalFeesPaid() {
      // nothing
    },
    // override defaults
    ...handlers
  };

  function handleEvent({ name, args = [] }) {
    assert(handlers[name], "No handler for event: " + name);
    try {
      return handlers[name](...args);
    } catch (err) {
      throw new Error("Error in handler " + name + ": " + err.message);
    }
  }

  function getCollateral() {
    return collateral;
  }
  function getTokens() {
    return tokens;
  }
  return {
    handleEvent,
    collateral,
    tokens
  };
}

module.exports = {
  EmpBalances,
  EmpBalancesHistory,
  AttributionHistory
};

/* eslint-enable no-unused-vars */
