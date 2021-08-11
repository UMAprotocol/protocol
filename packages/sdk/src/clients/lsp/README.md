# UMA SDK LSP Client

This is an LSP (Long Short Pair) contract client using ethers and typechain generated types.

## Usage

Connect to a typechain contract instance and recreate state from events.

```js
import {ethers} from 'ethers'
import uma from '@uma/sdk'

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance
const contractAddress:string = // assume you have an lsp address you want to connect to
const client:uma.clients.lsp.Instance = uma.clients.lsp.connect(contractAddress,provider)
// gets all events using etheres query filter api
const events = await client.queryFilter({})

// returns EventState, defined in the lsp client
const state:uma.clients.lsp.EventState = uma.clients.lsp.getEventState(events)

```
