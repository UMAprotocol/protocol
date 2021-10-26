# Across Contract Clients

These are utility libraries meant for supporting the Across dapp contract interactions.

## BridgePool Client

Interact with the bridge pool client for users who want to provide liquidity for relays.

### Read Only Client

This client is meant for reading state of the pool and specific users.

#### Quick Start

```ts
import * as uma from "@uma/sdk"
import { ethers } from "ethers"

const { ReadClient } = uma.across.clients.bridgePool
// this client requires multicall2 be accessible on the chain. This is the address for mainnet.
const multicall2Address = "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696"
// The client works on a single pool currently, this is the deployed pool for weth on mainnet.
const address = "0xf42bB7EC88d065dF48D60cb672B88F8330f9f764"
const provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL)

// Initializes the read client
const readClient = new ReadClient(address, provider, multicall2Address)

// to get pool state, omit any values
const poolState = await readClient.read()
//{
//  pool: {
//    address: '0xf42bB7EC88d065dF48D60cb672B88F8330f9f764',
//    totalPoolSize: '13900116882750652331',
//    l1Token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
//  }
//}

// to get user and pool state, provide a users public address
const userState = await readClient.read("0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D")
//{
//  user: {
//    address: '0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D',
//    lpTokens: '900000000000000000',
//    positionValue: '900000541941830509',
//    totalDeposited: '900000000000000000',
//    feesEarned: '541941830509'
//  },
//  pool: {
//    address: '0xf42bB7EC88d065dF48D60cb672B88F8330f9f764',
//    totalPoolSize: '13900116882750652331',
//    l1Token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
//  }
//}
```

#### Preview Liquidity Removal

Liquidity removal calculators are provided as static functions.

```js
import * as uma from "@uma/sdk"
const { previewRemoval } = uma.across.clients.bridgePool
const user = {
  address: "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D",
  lpTokens: "900000000000000000",
  positionValue: "900000541941830509",
  totalDeposited: "900000000000000000",
  feesEarned: "541941830509",
}
const percentFloat = 0.75 //user is removing 75% of position
const preview = previewRemoval(user.positionValue, user.feesEarned, percentFloat)
//{
//  position: { recieve: '675000406456372881', remain: '225000135485457628' },
//  fees: { recieve: '406456372881', remain: '135485457628' },
//  total: { recieve: '675000406456372881', remain: '225000135485457628' }
//}
```
