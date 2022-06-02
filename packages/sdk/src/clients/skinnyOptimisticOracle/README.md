# UMA SDK Skinny Optimistic Oracle Client

This is a basic wraper around the typechain Skinny Optimistic Oracle contract which adds some event decoding.

## Usage

Connect to a typechain contract instance and recreate state from events.

```js
import {ethers} from 'ethers'
import uma from '@uma/sdk'

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance
const contractAddress:string = // assume you have an skinny optimistic oracle address you want to connect to
const client:uma.clients.skinnyOptimisticOracle.Instance = uma.clients.skinnyOptimisticOracle.connect(contractAddress,provider)
// gets all events using etheres query filter api
const events = await client.queryFilter({})

// returns EventState, defined in the skinny optimistic oracle client
const state:uma.clients.skinnyOptimisticOracle.EventState = uma.clients.skinnyOptimisticOracle.getEventState(events)
// see all requests given even details
console.log(state.requests)

```
