# UMA Multicall2 Client

This client helps you batch multiple calls together in a single transaction. Useful also for
reducing api calls to infura when reading many properties from contracts.

## Usage

```ts
import { ethers } from "ethers"
import * as uma from "@uma/sdk"

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance
const client = uma.clients.multicall2.connect(address, provider)
```
