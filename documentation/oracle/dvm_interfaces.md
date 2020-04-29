# How Users and Voters Interact with the DVM

This document explains how various participants interact with the DVM. There are three primary _interfaces_ by which
different participants interact with the DVM:

- The _Oracle Interface_ is used by financial contracts that need a price to request it and then retrieve it once it's
  available.

- The _Store Interface_ is used by financial contracts to compute and pay the required DVM fees.

- The _Voting Interface_ is used by voters to vote for prices to resolve pending price requests.

Voters and financial contracts should only interact with the `Voting` instance registered in the `Finder` contract as
the `Oracle` interface.

## The Oracle Interface

The Oracle Interface is used by financial contracts to retrieve prices. This interface can only be used by financial
contracts that request prices _sparingly_. This is dependent on the specifics of the financial contract, but, in
general, prices should only be requested for dispute resolution and contract settlement.

There are four methods that make up the Oracle Interface: `requestPrice`, `hasPrice`, and
`getPrice`.

### `requestPrice`

A financial contract should use `requestPrice` whenever it needs a price from the DVM. Generally, it should only be
used as an arbitration mechanism to resolve disputes and to settle risk. If a financial contract template overuses this
function, it's unlikely to be approved for use with the DVM.

This method takes the asset (identifier) and the timestamp that uniquely specify the price that the contract wants.
This method only enqueues a request, it does not resolve it. This means it does not return a price. To check if a price is already available for this request, use `hasPrice`.

### `hasPrice`

A financial contract can use `hasPrice` to check if the DVM has resolved a previously requested price. It takes the same
inputs as `requestPrice`.

### `getPrice`

A financial contract should use `getPrice` to retrieve a previously requested price once it has been resolved. It takes
the same arguments as `requestPrice` and `hasPrice`. If the price is not available, this method does not fail
gracefully. For that case, check `hasPrice` before calling `getPrice`.

## The Store Interface

The Store Interface is used by financial contracts to compute and pay fees to the DVM. These fees are paid in whatever
currency the financial contract uses. For instance, if the price that the Oracle returns could cause Dai to change
hands, then the fee should be paid in Dai. For the purposes of this section, this currency is referred to as the
_margin currency_. If a financial contract template does not include code to honestly pay its fees, it will not be
approved to use the DVM.

There are two types of fees that must be paid using the Store Interface: regular fees and final fees.

The regular fee must be paid periodically for the life of the financial contract. It works similarly to interest - the
financial contract pays a percentage of its _profit from corruption_ (PfC) for every time period. The PfC is defined as
the maximum amount of money someone could steal from the contract if they were able to modify the price that the DVM
provides. The contract must pay the regular fee each time the contract's PfC changes. There is a penalty added to the
regular fee if the contract goes for more than a week (subject to change) without paying it. The more the payment is
delayed, the larger the penalty. Depending on the specifics of the financial contract, the penalty can go to a keeper
to incentivize them to call a public fee-payment method or it can go to the Store Interface.

The final fee is a simpler mechanism. It is a flat fee charged for each price request that the contract sends.

### `computeRegularFee`

A financial contract should use `computeRegularFee` whenever it needs to pay the regular fee to determine how much it
should pay. This method takes a `startTime` and `endTime` that designate the period that the contract is paying for.
Usually `startTime` should be the last time it paid the fee or the creation time of the contract if it has never paid
it. `endTime` should generally be the current time. It also takes a `pfc`, which is the PfC for the period.

This function returns two values:

- The amount of margin currency that the contract should pay the Store Interface as the normal fee.

- The amount of margin currency charged as a late penalty. This amount should generally be paid to a keeper as a reward
  for calling a public fee-payment method. If that isn't possible in the context of a particular financial contract, then
  it should be paid to the Store Interface in addition to the normal fee.

### `computeFinalFee`

A financial contract should use `computeFinalFee` to determine how much it needs to pay just before requesting a price.
The only argument is the address of the margin currency. The function returns the amount of that margin currency that
should be paid to the Store Interface.

### `payOracleFees`

If the financial contract's margin currency is ETH, all fees should be sent to the Store by calling this method and
sending ETH along with the call.

### `payOracleFeesErc20`

If the financial contract's margin currency is an ERC20, all fees should be sent using this method. The financial
contract should first approve the Store to spend the fee amount and then call this method. The Store will pull exactly
the amount that was approved.

## The Voting Interface

The Voting Interface is used by _token holders_ to vote on prices for pending price requests. When we say token holders
in this section, we are referring to UMA tokens, which should not be confused with synthetic tokens that are produced
by financial contracts that use the UMA DVM.

When a price is requested, voting starts when the next voting round begins. If multiple price requests are submitted,
voters can submit votes for each price request in the next voting round.

Voting rounds last 48 hours (subject to change). The first 24 hours is the commit period, where voters submit commit
hashes that bind them to a particular vote without revealing it. The second 24 hours is the reveal period, where voters
reveal the vote (and salt) that generated the commit hash.

After the reveal period ends, the price is considered resolved if enough voters submitted a vote. Once resolved, voters
can request their newly minted vote tokens as a reward for them voting with the majority.

### `getVotePhase`

Allows voters to check whether the contract is currently in the commit or reveal phase of voting. Note:
this will return commit or reveal even if there is nothing to vote on this round.

### `getCurrentRoundId`

Allows voters to check the current round id. This method isn't necessary for voters, but is
provided for informational purposes. The round ID is unique for every round where at least one vote is cast.

### `getPendingRequests`

Returns the list of price requests that are currently being voted on. Voters should use this at the beginning of the
round to determine what prices they need to look up and submit.

### `commitVote`

Submits a hash that binds a voter to a particular vote on a price request.

This method takes the `identifier` and `time` that uniquely identify the price request. This call will only work if a
price request for that `identifier` and `time` is returned from `getPendingRequests` and `getVotePhase` returns
`Commit`.

It also takes the `hash` that the voter wishes to commit to. The `hash` is created by computing
`keccak256(price, salt, time, address, roundId, identifier)`, where price is the `int256` price value that they wish to submit, `time` is the unix timestamp of the request being voted on, `address` is the voter's address (technically, the same one that will reveal the vote), `roundId` is the current voting round, `identifier` is the pricefeed identifier relevant to the price request, and `salt` is a random `int256` value. The voter must remember the inputs to the vote `hash` that they submitted so they can reveal their commit later - otherwise, the commit cannot be revealed and the vote won't be counted.

Since transaction data is public, the salt will be revealed along with the vote. While this is the system’s expected behavior,
voters should never reuse salts. If someone else is able to guess the voted price and knows that a salt will be reused, then
they can determine the vote pre-reveal.

A few notes:

- A voter can call this method multiple times during the commit period if they wish to change their commitment.
  It becomes locked in once the commit period ends.

- There are other commit methods that allow voters to batch and/or store encrypted salts/prices on chain. Those are
  not detailed here because they are unnecessary to understand the core Voting Interface.

### `revealVote`

Reveals a vote that the voter committed to during the commit period.

This method takes the `identifier` and `time` to identify the price request.

So the reveal can be verified on-chain, the voter must also provide the `price` and `salt` that they used to compute
the `hash` that they passed to `commitVote`.

Note: the voter's token balance is important for computing how much their vote impacts the outcome and how many newly
minted tokens they receive as a reward for voting correctly. For that purpose, all voters' balances are snapshotted
when the first voter calls `revealVote` during a voting round.

### `retrieveRewards`

Retrieves tokens that the voter has earned from voting, but hasn't yet withdrawn.

This method takes an array of `PendingRequest` objects that a voter can claim rewards for (i.e., voted correctly and
haven't already claimed rewards). All of those price requests must be part of the same `roundId`.

This method takes a `voterAddress` to identify the voter that will be rewarded. Any one can call this method for any
voter.

A few notes:

- It is not necessary to claim rewards in ascending order of round ids.

- A voter can call this method multiple times with the same `roundId` as long as price requests are different.

- The event `PriceResolved` is emitted on the first voter to retrieve rewards for a price request.

- For convenience, returns the number of tokens minted and awarded.
