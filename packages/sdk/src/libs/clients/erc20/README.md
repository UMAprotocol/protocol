# UMA SDK ERC20 Client

Client to interface with ERC20 style tokens, based on Ethers and typechain.

## Usage

```js
import {ethers} from 'ethers'
import * as uma from '@uma/sdk'

// assume you have a url injected from env
const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL)

// get the contract instance
const erc20Address:string = // assume you have an emp address you want to connect to
const erc20Instance:uma.clients.erc20.Instance = uma.clients.erc20.connect(erc20Address,provider)

// gets all emp events, see ethers queryFilter for details on contructing the query.
const events = await erc20Instance.queryFilter({})

// returns EventState, defined in the emp client. This can contain user balances as well as approval limits.
const state:uma.clients.erc20.EventState = uma.clients.erc20.getEventState(events)

// Types
types {Transfer,Approval, Instance, EventState} = uma.clients.erc20
// Transfer and Approval are event types
// Instance is the contract instance once connected
// Event state describes what the state reconstruction based on contract events will look like

```
