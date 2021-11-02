# UMA SDK Bridge Pool Client

## Usage

Connect to a typechain contract instance and recreate state from events.

```js
import {ethers} from 'ethers'
import * as uma from '@uma/sdk'

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance
const contractAddress:string = 0x...
const client:uma.clients.bridgePool.Instance = uma.clients.bridgePool.connect(contractAddress,provider)
// gets all events using etheres query filter api
const events = await client.queryFilter({})

// returns EventState, defined in the lsp client
const state:uma.clients.bridgePool.EventState = uma.clients.bridgePool.getEventState(events)

```
