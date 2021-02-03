const { Balances, History, SharedAttributions } = require("./models");
const assert = require("assert");
const { DecodeAttribution, isAddress } = require("./contracts");

function EmpAttributions(empAbi, defaultAddress) {
  assert(empAbi, "requires empAbi");
  assert(defaultAddress, "requires defaultAddress");
  // stores complete balances for all events
  const attributions = SharedAttributions();
  const decoder = DecodeAttribution(empAbi);

  function handleTransaction(transaction) {
    assert(transaction.name == "create", "Can only handle emp create transactions");
    // decoder may return nothing, garbage data, or a hex address without the 0x prepended
    const tag = "0x" + decoder(transaction);
    let attributionAddress = defaultAddress;
    // validate the tag is an address, otherwise fallback to default address
    // currently we will only accept valid addresses as a tag, this may change in future.
    if (isAddress(tag)) attributionAddress = tag;
    const user = transaction.from_address;
    const [, tokenAmount] = transaction.args;
    attributions.attribute(user, attributionAddress, tokenAmount.toString());
  }

  return {
    handleTransaction,
    attributions
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
    assert(blockNumber === 0 || blockNumber > 0, "requires blockNumber");
    if (lastBlockNumber == null) {
      lastBlockNumber = blockNumber;
      lastBlockTimestamp = event.blockTimestamp;
    } else if (lastBlockNumber < blockNumber) {
      history.insert({
        blockNumber: lastBlockNumber,
        blockTimestamp: event.blockTimestamp,
        tokens: balances.tokens.snapshot(),
        collateral: balances.collateral.snapshot(),
        isExpired: balances.isExpired()
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
      collateral: balances.collateral.snapshot(),
      isExpired: balances.isExpired()
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

  // Doesnt quite fit under umbrella of "balances" but this is the easiest place to set an expired flag.
  let expired = false;
  function isExpired() {
    return expired;
  }

  handlers = {
    RequestTransferPosition(/* oldSponsor*/) {
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
    RequestTransferPositionCanceled(/* oldSponsor*/) {
      // nothing
    },
    Deposit(sponsor, collateralAmount) {
      collateral.add(sponsor, collateralAmount.toString());
    },
    Withdrawal(sponsor, collateralAmount) {
      collateral.sub(sponsor, collateralAmount.toString());
    },
    RequestWithdrawal(/* sponsor, collateralAmount*/) {
      // nothing
    },
    RequestWithdrawalExecuted(sponsor, collateralAmount) {
      collateral.sub(sponsor, collateralAmount.toString());
    },
    RequestWithdrawalCanceled(/* sponsor, collateralAmount*/) {
      // nothing
    },
    PositionCreated(sponsor, collateralAmount, tokenAmount) {
      collateral.add(sponsor, collateralAmount.toString());
      tokens.add(sponsor, tokenAmount.toString());
    },
    NewSponsor(/* sponsor*/) {
      // nothing
    },
    EndedSponsorPosition(/* sponsor*/) {
      // nothing
    },
    Redeem(sponsor, collateralAmount, tokenAmount) {
      collateral.sub(sponsor, collateralAmount.toString());
      tokens.sub(sponsor, tokenAmount).toString();
    },
    ContractExpired(/* caller*/) {
      expired = true;
      // nothing
    },
    // looking at the emp code, i think anyone can call this even if they never had a position
    // this means balances may not exist or may go below 0. We allow balances to go negative.
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
      liquidatedCollateral
      // liquidationTime
    ) {
      collateral.sub(sponsor, liquidatedCollateral.toString());
      tokens.sub(sponsor, tokensOutstanding.toString());
    },
    LiquidationWithdrawn(/* caller, originalExpirationTimestamp, shutdownTimestamp*/) {
      // nothing
    },
    LiquidationDisputed(/* caller, originalExpirationTimestamp, shutdownTimestamp*/) {
      // nothing
    },
    DisputeSettled() {
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

  return {
    handleEvent,
    collateral,
    tokens,
    isExpired
  };
}

module.exports = {
  EmpBalances,
  EmpBalancesHistory,
  EmpAttributions
};
