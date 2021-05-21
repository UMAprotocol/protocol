# UMA SDK Client Registry
This represents the EMP Registry client, useful for finding all deployed EMP contracts.

## Usage
```js
import {ethers} from 'ethers'
import uma from '@uma/sdk'
const {Registry} from uma.clients

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance, address lookup happens based on network 
const contract = Registry.connect(provider,1)
// get all contract registered events, using standard ethers API
const events = await contract.queryFilter(contract.filters.NewContractRegistered(null,null,null))

// returns a map of contracts:[address:key]:event:Event
const {contracts} = Registry.getEventState(events)

```
