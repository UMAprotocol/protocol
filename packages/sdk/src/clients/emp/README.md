# UMA SDK EMP Client

This is emp contract client using ethers and typechain generated types.

## Usage

This can calculate user balances for both tokens and collateral within the emp contract using events.

```js
import {ethers} from 'ethers'
import uma from '@uma/sdk'

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance
const empAddress:string = // assume you have an emp address you want to connect to
const empInstance:uma.clients.emp.Instance = uma.clients.emp.connect(empAddress,provider)
// gets all emp events
const empEvents = await empInstance.queryFilter({})

// returns EventState, defined in the emp client
const state:uma.clients.emp.EventState = uma.clients.emp.getEventState(empEvents)

```
