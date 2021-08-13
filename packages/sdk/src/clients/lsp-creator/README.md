# UMA SDK LSP Creator Client

This contract is a long short pair (LSP) factory. Discover all LSP contracts deployed through the creator.

## Usage

Get the address of a deployed LSP Creator based on your network, and discover LSP contracts by querying events.

```js
import { ethers } from "ethers"
import uma from "@uma/sdk"

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance, address lookup happens based on network (1)
const address = uma.clients.lspCreator.getAddress("1")
const client: uma.clients.lspCreator.Instance = uma.clients.lspCreator.connect(address, provider)
// get all contract registered events, using standard ethers API, empty object gets all events for all time.
const events = await client.queryFilter({})

// returns EventState, defined in the lsp-creator client
const state: uma.clients.lspCreator.EventState = uma.clients.lspCreator.getEventState(events)
```
