# Adding a Price Identifier

## What is a price identifier?

A [price identifier](../../synthetic_tokens/glossary.md#price-identifier) is a natural language descriptor of a reference index, whose value the oracle will determine upon request.
Because UMA token holders need to be able to vote on the value of this price identifier when disputes are raised, the DVM keeps a list of approved price identifiers.

For example, `GOLD_USD` might be a price identifier to return the USD spot price of 1oz of gold according to a pre-defined set of rules. If approved, UMA token holders would be expected to vote on the `GOLD_USD` value when price requests are raised to the DVM.
The rules behind this `GOLD_USD` price identifier would be documented in detail in an [UMIP](./UMIPs.md) that was has been approved by UMA token holders.
That UMIP would contain more information about how to determine the price identifier.

<!-- TODO: Add a link to the UMIP for adding the ETHBTC price identifier when it is ready. -->

## Who controls the list of approved price identifiers?

For each deployment of the DVM, the list of approved price identifiers is controlled by the `IdentifierWhitelist` contract.
In local and testnet deployments of the DVM, `IdentifierWhitelist` is controlled by a single private key.
In the mainnet deployment of the DVM, `IdentifierWhitelist` is controlled by a decentralized governance process, as described below.

## Adding a price identifier to a local deployment

In a local deployment, your private key controls the `IdentifierWhitelist` contract.
You can therefore add any price identifier desired using the `IdentifierWhitelist.addSupportedIdentifier`, as described in step 5 of this [tutorial](../../synthetic_tokens/tutorials/creating_from_truffle.md).

<!-- TODO: Add a section for ## Adding a price identifier to a testnet deployment -->

## Adding a price identifier to the mainnet deployment

The `IdentifierWhitelist` contract in the mainnet deployment of the UMA DVM is controlled by a decentralized governance process.
To add a new price identifier, UMA token holders must vote and approve the identifier.
This is done via the UMIP process, as described [here](./UMIPs.md).

- Step 1: Discuss

If you are building with a price identifier not currently supported by the UMA DVM, you will need to propose it to the community of UMA token holders for a vote.
You should create an UMIP in which you describe your project and the new price identifier(s) being requested.
At this time, you do not need to provide an implementation for the addition of a new price identifier.
Details on how to write a UMIP are [here](./UMIPs.md). This UMIP will be discussed by members of the UMA community.

- Step 2: Get Ready For Vote

In order for the UMIP to move to the next stage of discussion, you should construct an off-chain transaction to add the proposed price identifier to the mainnet `IdentifierWhitelist`. This transaction should be attached to the UMIP.

- Step 3: Vote

UMA voters will vote on the proposed transaction. Each UMA token represents one vote. If at least 5% of all tokens are used to vote, of which >50% of votes approve the UMIP, the UMIP is considered approved.

- Step 4: Execute Transaction

Once the proposal has been approved, anyone can tell the governor contract to execute the proposed transaction.
The governor contract will then execute the transaction, approving the identifier in `IdentifierWhitelist`.
