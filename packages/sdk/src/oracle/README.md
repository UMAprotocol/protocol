# Oracle Client

Interact with UMA's Optimistic Oracle using an eventful client designed for a frontend dapp with global state management.

# Quick Start

In order to start a client, you need to know if you will be interfacing with the skinny optimistic oracle, or
standard optimistic oracle. They have an identical interface, use the factory and specify the configuration for which type or
types you intend to use.

```js
import {oracle} from '@uma/sdk'

type PartialConfig = oracle.types.state.PartialConfig
type PartialConfigTable = oracle.types.state.PartialConfigTable

// creating a config for mainnet usage add any additional chains you want following the same format
const config:PartialConfig = {
  chains: {
    // adding a mainnet chain configuration
    1:{
      chainName: "Ethereum",
      rpcUrls: [process.env.CUSTOM_NODE_URL],
      blockExplorerUrls: ["https://etherscan.io"],
      nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18,
      },
      // additional params you can override per chain
      checkTxIntervalSec: number; // how fast transactions are checked for confirmation, default 5
      multicall2Address?: string; // optional multicall address for more efficient calls
      optimisticOracleAddress: string; // override default oracle address, or provide one if we cannot look it up, ie with testing
      earliestBlockNumber?: number;  // ignore blocks before this block number if specified
      maxEventRangeQuery?: number;  // optimize how quickly the first batch of requests are fetched by restricting the max number of events queried.
      disableFetchEventBased?: boolean; // disables checking all requests for event based data, which may slow down app or cause high requests
      fetchEventBasedConcurrency?: number; // set the concurrency for fetching event based data on requests, default 5
    },
    // other chains follow the same configuration schema
  },
};

// this starts both a skinny and optimistic oracle, you have to make sure to omit the oracle address
// in the config to let them auto populate, or make sure you set the addresses differently for each type
const configTable = {
  [oracle.types.state.OracleType.Optimistic]: config,
  [oracle.types.state.OracleType.Skinny]: config,
}

const state = {
  [oracle.types.state.OracleType.Optimistic]:{},
  [oracle.types.state.OracleType.Skinny]:{},
}
function changeHandler(oracleType: oracle.types.state.OracleType, state: oracle.types.state.State, prev: oracle.types.state.State):void {
  // update state for the particular oracle type
  state[oracleType] = state
}
const clients = oracle.factory(configTable,changeHandler)

// regular OO
const optimistic = clients[oracle.types.state.OracleType.Optimistic]
// skinny OO
const skinny = clients[oracle.types.state.OracleType.Skinny]

// both clients have the exact same interface and return the same data
// client contains the following classes and calls:
//{
//  store: { read, write, get} // get and set all parts of state
//  setUser: // set the currently logged in user
//  clearUser: // log user out
//  setActiveRequest: // set the request page the user is on
//  approveCollateral: // send tx to approve collateral for user
//  proposePrice:  // send tx to propose price on request
//  disputePrice: // send tx to dispute price on request
//  switchOrAddChain: // switch or add a new chain for user
//  startInterval: // should always run this after init, starts processing loop
//  stopInterval: // stop processing loop
//}

// you should always start this to kick off internal processing
optimistic.startInterval()
skinny.startInterval()

const requester = "0xb8b3583f143b3a4c2aa052828d8809b0818a16e9",
const identifier = "0x554D415553440000000000000000000000000000000000000000000000000000"
const timestamp = 1638453600
const ancillaryData = "0x747761704C656E6774683A33363030",

const account = "0x9A8f92a830A5cB89a3816e3D267CB791c16b04D";
const chainId = 1

// currently the order of calls is important
optimistic.setActiveRequest({ requester, identifier, timestamp, ancillaryData, chainId })
optimistic.setUser({ address:account, chainId, signer:rpcSigner, provider:web3Provider })

// global state will be updated with the needed information
// you can also manually fetch from store using array paths, but this isnt recommended.
// recommended way
let userAddress = state?.input?.user?.address
// you can also get it from the store
userAddress = optimistic.store.read().userAddress()

// fetched from contract
let fullRequest = state.chains?.[chainId]?.optimisticOracle?.requests?.[requestId]
// or get from store
fullRequest = optimistic.store.read().request()

// inspect types/state.ts for shape of state data.
```

## Flags

Based on the current state of the entire system, we can reduce down a few key boolean states we call flags.
These flags can be used to quickly identify major state configurations without a lot of logic.

```ts
import { oracle } from "@uma/sdk"

// types shown from types/state
export type Flags = Record<Flag, boolean>
export enum Flag {
  MissingRequest = "MissingRequest", // the client does not know the request, use client.setActiveRequest
  MissingUser = "MissingUser", // client does not have user data, use client.setUser
  WrongChain = "WrongChain", // user and request chain ids do not match, switch chains with client.switchOrAddChain
  CanPropose = "CanPropose", // The on chain request is in a state where someone could propose, use client.proposePrice
  CanDispute = "CanDispute", // The on chain request is in a state where someone could dispute, use client.disputePrice
  CanSettle = "CanSettle", // The on chain request is in a stae where someone could settle the request.
  InDvmVote = "InDvmVote", // Proposed answer has been disputed and passed to dvm for full vote.
  RequestSettled = "RequestSettled", // Request is finalized, no more changes.
  InsufficientBalance = "InsufficientBalance", // The user does not have enough balance to cover bond collateral for dispute/propose
  InsufficientApproval = "InsufficientApproval", // The oracle contract does not have enough approval to cover bond for dispute/propose, use client.approve
  ChainChangeInProgress = "ChainChangeInProgress", // The user is changing his chain
  ProposalTxInProgress = "ProposalTxInProgress", // The user is sending a proposal tx
  ApprovalTxInProgress = "ApprovalTxInProgress", // The user is sending an approval tx
  DisputeTxInProgress = "DisputeTxInProgress", // The user is sending a dispute tx
}

// given the state of the system
const flags: oracle.types.state.Flags = oracle.utils.getFlags(state)
```

## Commands

All write requests to the client from the user are in the form of a stateful request which gets updated in global state.
We call these requests commands, and they all follow a specific interface which can be inspected programmatically or manually.

Commands on the client are currently:

- setUser
- clearUser
- setActiveRequest
- approveCollateral
- proposePrice
- disputePrice
- switchOrAddChain
- setActiveRequestByTransaction

These functions are all syncronous and can throw errors, but on success will return a string which represents the id of the command issued.
You can fetch a command through:

`const cmd = client.store.read().command(commandId)`

Commands will be attached to global state at `state.commands`.

### Success State

Commands will be done when `command.done == true`. You can also check `command.state == 'done'` for a successful completion.

### Error State

Commands can error, in this case `command.done == true` and `command.state == 'error'`. In this condition
the command will have a `command.error` object with the full error message and stack trace.

## Client

The oracle client is what manages state, emits state updates and lets you interact with the blockchain.

### Contruction

This uses a factory for construction.  
See `oracle/types/state.PartialConfig` for your full configuration object.  
See `oracle/types/state.State` for full application state object.

`oracle.client.factory(config: oracle.types.state.PartialConfig, emit: (state: oracle.types.state.State, prev: oracle.types.state.State) => void): Client`

### setUser

Sets the currently logged in user. This allows partial updates. Returns a string identifier for checking result of mutation.

`client.setUser(params:oracle.types.state.Partial<User>): string`

### setUser

Clears the current user.

`client.clearUser(): string`

### setActiveRequest

Tell the client what request you want to interact with.

`client.setActiveRequest(params: {chainId:number, requester: string; identifier: string, timestamp: number, ancillaryData: string }): string`

### approveCollateral

Based on the current active request and logged in user, approve collateral for the optimistic oracle to spend.

`approveCollateral(): string`

### proposePrice

Based on user and active request, propose a price for the request. The price passed in should be a float, ie the natural input from user.

`proposePrice(proposedPriceDecimals: string | number): string`

### disputePrice

Based on user and active request, dispute a price currently proposed for request.
`disputePrice(): string`

### settle

Based on user and active request, settle a price available for the request. Can do this if flags.CanSettle is true.
`settle(): string`

### switchOrAddChain

If the user is on the wrong chain to interact with request, call this to get them on the right chain, or add the chain and switch.
This requires the `metadata` option on the config for each chain is set.

`switchOrAddChain(): string`

### setActiveRequestByTransaction

Tell the client what request you want to interact with by specifying the transaction hash, chainId and optional eventIndex.

`client.setActiveRequestByTransaction(params: { chainId: number; transactionHash: string; eventIndex?: number }): string`

## Types

For detailed types, see `oracle/types/state.ts`. There are also a few types in `oracle/services/store/index.ts`.
For command type details, see the `ContextProps` type in `oracle/types/statemachine`.

## Reading State

There will be times you need to read data from global state. There are a couple ways to do this, one is with the reader class.

`const reader = client.store.read()`

You should instance this reader every time you want to make a query, as it can become stale as state changes.
The reader will throw errors currently if values do not exist, this makes it inconvenient to use at times.
For a full list of queries, see `oracle/store/read.ts`

or

```js
import { oracle } from "@uma/sdk"
const Read = oracle.store.Read

// reads directly from the current state
const read = new Read(state)

try {
  const user = read.user()
} catch (err) {
  // the reader will throw an error if user has not been set
}
```
