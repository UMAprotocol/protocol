# UMA SDK Optimistic Oracle V2 Client

This is a basic wraper around the typechain Optimistic Oracle V2 contract which adds some event decoding.

## Usage

Connect to a typechain contract instance and recreate state from events.

```js
import { ethers } from "ethers"
import uma from "@uma/sdk"

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance
const contractAddress: string = "0xA0Ae6609447e57a42c51B50EAe921D701823FFAe" // assume you have an optimistic oracle address you want to connect to
const client: uma.clients.optimisticOracleV2.Instance = uma.clients.optimisticOracleV2.connect(
  contractAddress,
  provider
)
// gets all events using etheres query filter api
const events = await client.queryFilter({})

// returns EventState, defined in the optimistic oracle client
const state: uma.clients.optimisticOracleV2.EventState = uma.clients.optimisticOracleV2.getEventState(events)
// see all requests given even details
console.log(state.requests)
```
