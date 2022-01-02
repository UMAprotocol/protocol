# Oracle Client

Interact with UMA's Optimistic Oracle using an eventful client designed for a frontend dapp with global state management.

# Quick Start

Currently theres a single factory which creates the client and allows you to subscribe to state changes.

```js
import {oracle} from '@uma/sdk'

// create your configuration object with known addresses
type Config = oracle.types.state.Config

// creating a config for mainnet usage add any additional chains you want
export const config = {
  chains: {
    1:{
      chainId: 1,
      multicall2Address: process.env.multicall2Address,
      optimisticOracleAddress: process.env.optimisticOracleAddress,
      providerUrl: process.env.CUSTOM_NODE_URL,
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
//  update: {// all update calls} // update parts of state on chain
//  setUser: // set the currently logged in user
//  setActiveRequest: // set the request page the user is on
//}

const requester = "0xb8b3583f143b3a4c2aa052828d8809b0818a16e9",
const identifier = "0x554D415553440000000000000000000000000000000000000000000000000000"
const timestamp = 1638453600
const ancillaryData = "0x747761704C656E6774683A33363030",

const account = "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D";
const chainId = ChainId.MAINNET;

// currently the order of calls is important
client.setActiveRequest(requester,identifier,timestamp,ancillaryData)
client.setUser(account,chainId)


// update parts of state from on chain. It requires that data is first set. It will throw errors if required data is unavailable.
// inspect client.ts for all update calls.
// updates state of current request on chain
await client.update.request()
// updates default liveness from oracle
await client.update.oracle()
// update everything, only run if both user and request has been set
await client.update.all()

// global state will be updated with the needed information
// you can also manually fetch from store using array paths, but this isnt recommended.
// recommended way
let userAddress = state.user?.address
// you can also get it from the store
userAddress = client.store.read().userAddress()

// fetched from contract
let fullRequest = state.chains?.[chainId]?.optimisticOracle?.requests?.[requestId]
// or get from store
fullRequest = client.store.read().request()

// inspect types/state.ts for shape of state data.
```
