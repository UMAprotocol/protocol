# UMA SDK Client Registry

This represents the EMP Registry client, useful for finding all deployed EMP contracts.

## Usage

```js
import {ethers} from 'ethers'
import uma from '@uma/sdk'
const {Registry} from uma.clients

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance, address lookup happens based on network (1)
const registryAddress = Registry.getAddress("1")
const registryInstance = Registry.connect(address,provider)
// get all contract registered events, using standard ethers API
const registryEvents = await registryInstance.queryFilter(registryInstance.filters.NewContractRegistered(null,null,null))

// returns a map of contracts:[address:key]:event:Event
const {contracts:registeredContracts} = Registry.getEventState(registryEvents)

```
