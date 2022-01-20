# Oracle Client

Interact with UMA's Optimistic Oracle using an eventful client designed for a frontend dapp with global state management.

# Quick Start

Currently theres a single factory which creates the client and allows you to subscribe to state changes.

```js
import {oracle} from '@uma/sdk'

// create your configuration object with known addresses
type Config = oracle.types.state.Config

// creating a config for mainnet usage add any additional chains you want following the same format
export const config = {
  chains: {
    1:{
      chainId: 1,
      multicall2Address: "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696",
      optimisticOracleAddress: "0xC43767F4592DF265B4a9F1a398B97fF24F38C6A6",
      providerUrl: process.env.CUSTOM_NODE_URL,
      metadata:{
        chainId: 1,
        rpcUrls: [],
        nativeCurrency: {
          name: "Ether",
          symbol: "ETH",
          decimals: 18,
        },
        chainName: "Ethereum",
        blockExplorerUrls: "https://etherscan.io"
      }
    },
  },
};

let state:oracle.types.state.State = {}
function changeHandler(nextState:oracle.types.state.State, prevState:oracle.types.state.State){
 // dispatch to state manager. Recommended to have its own slice of state.
 state = nextState
}

const client = Factory(config, changeHandler);
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
client.startInterval()

const requester = "0xb8b3583f143b3a4c2aa052828d8809b0818a16e9",
const identifier = "0x554D415553440000000000000000000000000000000000000000000000000000"
const timestamp = 1638453600
const ancillaryData = "0x747761704C656E6774683A33363030",

const account = "0x9A8f92a830A5cB89a3816e3D267CB791c16b04D";
const chainId = 1

// currently the order of calls is important
client.setActiveRequest({requester,identifier,timestamp,ancillaryData,chainId})
client.setUser({address:account,chainId,signer:rpcSigner,provider:web3Provider})

// global state will be updated with the needed information
// you can also manually fetch from store using array paths, but this isnt recommended.
// recommended way
let userAddress = state?.input?.user?.address
// you can also get it from the store
userAddress = client.store.read().userAddress()

// fetched from contract
let fullRequest = state.chains?.[chainId]?.optimisticOracle?.requests?.[requestId]
// or get from store
fullRequest = client.store.read().request()

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
  InProposeState = "InProposeState", // The on chain request is in a state where someone could propose, use client.proposePrice
  InDisputeState = "InDisputeState", // The on chain request is in a stae where someone could dispute, use client.disputePrice
  InsufficientBalance = "InsufficientBalance", // The user does not have enough balance to cover bond collateral for dispute/propose
  InsufficientApproval = "InsufficientApproval", // The oracle contract does not have enough approval to cover bond for dispute/propose, use client.approve
  ChainChangeInProgress = "ChainChangeInProgress", // The user is changing his chain
  ProposalInProgress = "ProposalInProgress", // The user is sending a proposal tx
  ApprovalInProgress = "ApprovalInProgress", // The user is sending an approval tx
  DisputeInProgress = "DisputeInProgress", // The user is sending a dispute tx
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

`oracle.client.factory(config: oracle.types.state.Config, emit: oracle.services.store.Emit): Client`

### setUser

Sets the currently logged in user. This allows partial updates. Returns a string identifier for checking result of mutation.

`client.setUser(params:oracle.types.state.Partial<User>): string`

### setUser

Clears the current user.

`client.clearUser(): string `

### setActiveRequest

Tell the client what request you want to interact with.

`client.setActiveRequest(params: oracle.types.state.InputRequest): string`

### approveCollateral

Based on the current active request and logged in user, approve collateral for the optimistic oracle to spend.

`approveCollateral(): string`

### proposePrice

Based on user and active request, propose a price for the request. The price passed in should be a float, ie the natural input from user.

`proposePrice(proposedPriceDecimals: string | number): string`

### disputePrice

Based on user and active request, dispute a price currently proposed for request.
`disputePrice(): string`

### switchOrAddChain

If the user is on the wrong chain to interact with request, call this to get them on the right chain, or add the chain and switch.
This requires the `metadata` option on the config for each chain is set.

`switchOrAddChain(): string`

## Types

For detailed types, see `oracle/types/state.ts`. There are also a few types in `oracle/services/store/index.ts`.
For command type details, see the `ContextProps` type in `oracle/types/statemachine`.

## Reading State

There will be times you need to read data from global state. There are a couple ways to do this, one is with the reader class.

`const reader = client.store.read()`

You should instance this reader every time you want to make a query, as it can become stale as state changes.
The reader will throw errors currently if values do not exist, this makes it inconvenient to use at times.
For a full list of queries, see `oracle/store/read.ts`
