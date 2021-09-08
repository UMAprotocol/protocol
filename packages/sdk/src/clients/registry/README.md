# UMA SDK Registry Client

This represents the EMP Registry client, useful for finding all deployed EMP contracts.

## Usage

```js
import { ethers } from "ethers"
import uma from "@uma/sdk"

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance, address lookup happens based on network (1)
const registryAddress = await uma.clients.registry.getAddress("1")
const registryInstance: uma.clients.registry.Instance = uma.clients.registry.connect(address, provider)
// get all contract registered events, using standard ethers API
const registryEvents = await registryInstance.queryFilter(
  registryInstance.filters.NewContractRegistered(null, null, null)
)

// returns EventState, defined in the registry client
const state: uma.clients.registry.EventState = uma.clients.registry.getEventState(registryEvents)
```
