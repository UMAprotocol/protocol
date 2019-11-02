# How Users and Voters Interact with the DVM

This document explains how various participants interact with the DVM. There are three primary _interfaces_ by which
different participants interact with the DVM:

- The _Oracle Interface_ is used by financial contracts that need a price to request it and then retrieve it once it's
available.

- The _Store Interface_ is used by financial contracts to compute and pay the required DVM fees.

- The _Voting Interface_ is used by voters to vote for prices to resolve pending price requests.

## The Oracle Interface

The Oracle Interface is used by financial contracts to retrieve prices. This interface can only be used by financial
contracts that request prices _sparingly_. This is somewhat dependent on the specifics of the financial contract, but,
in general, prices should only be requested to resolve disputes resolution and settlement.

There are four methods that make up the Oracle Interface: `isIdentifierSupported`, `requestPrice`, `hasPrice`, and
`getPrice`.

### `isIdentifierSupported`

During deployment, if a financial contract could, at some point, require a price for an asset (identifier), it should
double check that the DVM supports that asset by calling `isIdentifierSupported(identifier)`. If that asset is not
supported, the deployment should revert.

This method doesn't require the contract to be approved, and it can be called by an EOA for informational purposes.

### `requestPrice`

A financial contract should use `requestPrice` whenever it needs a price from the DVM. Generally, it should only be
used as an arbitration mechanism to resolve disputes and to settle risk. If a financial contract template overuses this
function, it's unlikely to be approved for use with the DVM.

This method takes the asset (identifier) and the timestamp that uniquely specify the price that the contract wants.
This method only enqueues a request, it does not resolve it. This means it does not return a price. Rather, it returns
the timestamp when the request is expected to be resolved. If 0 is returned, a price is already available for this
request.

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
delayed, the larger the penalty.

The final fee is a simpler mechanism. It is a flat fee charged for each price request that the contract sends.

### `computeRegularFee`

A financial contract should use `computeRegularFee` whenever it needs to pay the regular fee to determine how much it
should pay. This method takes a `startTime` and `endTime` that designate the period that the contract is paying for.
Usually `startTime` should be the creation time of the contract if it has never paid a regular fee or the
the last time it paid it. `endTime` should generally be the current time. It also takes a `pfc`, which is the PfC for
the period.

This function returns the amount of margin currency that the contract should pay the Store Interface.

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

TODO
