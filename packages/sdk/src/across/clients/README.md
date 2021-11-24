# Across Contract Clients

These are utility libraries meant for supporting the Across dapp contract interactions.

## BridgePool Client

Interact with the bridge pool client for users who want to provide liquidity for relays.

### Quick Start

```ts
import * as uma from "@uma/sdk"
import { ethers } from "ethers"
import lodash from "lodash"

const { Client, State } = uma.across.clients.bridgePool
// this client requires multicall2 be accessible on the chain. This is the address for mainnet.
const multicall2Address = "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696"
// The client works on a single pool currently, this is the deployed pool for weth on mainnet.
const wethPool = "0xf42bB7EC88d065dF48D60cb672B88F8330f9f764"
const userAddress = "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D"
const provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL)

// Hook into your store or dispatch here. This will emit paths that change data.
// The data state its building looks like this:
// export type State = {
//   pools: Record<string, Pool>;
//   users: Record<string, Record<string, User>>;
//   transactions: Record<string, Transaction>;
// };
const state: State = {}
function eventHandler(path: string[], data: any) {
  lodash.set(state, path, data)
}
// Initializes the read client
const client = new Client({ multicall2Address }, { provider }, eventHandler)

// to get pool state, omit any values
await client.updatePool(wethPool)
const pool = lodash.get(state, ["pools", wethPool])
// or
const pool = client.getPool(wethPool)
// {
//   address: '0x75a29a66452C80702952bbcEDd284C8c4CF5Ab17',
//   totalPoolSize: '14000109368430725411',
//   l1Token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
//   liquidReserves: '13386109368430725412',
//   pendingReserves: '0',
//   exchangeRateCurrent: '1000003603469406073',
//   exchangeRatePrevious: '1000003603402421313',
//   estimatedApy: '0.0001554854987408569'
// }

// to get user and pool state, provide a users public address and the pool
await client.updateUser(userAddress, wethPool)
const user = lodash.get(state, ["users", userAddress, wethPool])
// or
const user = client.getUser(userAddress, wethPool)
//  {
//    address: '0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D',
//    poolAddress: '0x75a29a66452C80702952bbcEDd284C8c4CF5Ab17',
//    lpTokens: '1000000000000000000',
//    positionValue: '1000003603096205268',
//    totalDeposited: '999998479837042055',
//    feesEarned: '5123259163213'
//  }
```

### Preview Liquidity Removal

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
const preview = previewRemoval(
  // or just pass in user object
  { positionValue: user.positionValue, feesEarned: user.feesEarned, totalDeposited: user.totalDeposited },
  percentFloat
)
//{
//  position: { recieve: '675000406456372881', remain: '225000135485457628' },
//  fees: { recieve: '406456372881', remain: '135485457628' },
//  total: { recieve: '675000406456372881', remain: '225000135485457628' }
//}
```

### Reading State

### Submit Deposit / Withdraw

Submits transactions to the blockchain on behalf of the user. Requires signer and pool address.

**async addEthLiquidity(signer: Signer, pool: string, l1TokenAmount: BigNumberish) => string**  
**async addTokenLiquidity(signer: Signer, pool: string, l1TokenAmount: BigNumberish) => string**

Note that adding liquidity requires the token amount you want to send in tokens native decimals. The functions
are split between raw eth deposit vs erc20 deposit.

**async removeTokenLiquidity(signer: Signer, pool: string, lpTokenAmount: BigNumberish) => string**  
**async removeEthliquidity(signer: Signer, pool: string, lpTokenAmount: BigNumberish) => string**

Note that removing liquidity requires the LP token amount you want to burn to receive underlying collateral. The functions
are split between raw eth removal vs erc20 removal.

#### Example

```js
const exampleAmount = toWei("1")
const signer: ethers.Signer = new ethers.Wallet() // get a signer somehow
const txid = await client.addEthLiquidity(signer, wethPool, userAddress, exampleAmount)
// txid is not a normal transaction id, but how the client internally tracks the transaction.
// Its returned in case you want to track progress of this transaction

const transaction = lodash.get(state, ["transactions", txid])
// or
const transaction = client.getTx(txid)
// {
//   id: string;
//   state: "requested" | "submitted" | "mined" | "error";
//   toAddress: string;
//   fromAddress: string;
//   type: "Add Liquidity" | "Remove Liquidity";
//   description: string;
//   request?: TransactionRequest;
//   hash?: string;
//   receipt?: TransactionReceipt;
//   error?: Error;
// }
```

### Tracking Transactions

You must manually call `startInterval` or 'updateTransactions' on an interval manually you care about tracking transactions. This is optional.

```js
// updates once every 30 seconds
client.startInterval(/* optionally pass in ms to update, defaults to 30 seconds */)
// completed transactions will have the state "mined"

// stops checking for transactions
client.stopInterval()
```

## Optimism Bridge Client

```ts
// Initialize the L1 and the L2 Web3 Providers
const l1provider = ethers.getDefaultProvider(<L1_RPC_URL>);
const l2provider = ethers.getDefaultProvider(<L2_RPC_URL>);
const client = new OptimismBridgeClient();
// Signer who makes the deposit. Construct it using ethers or use the signer provided by Metamask
const signer = new Wallet(<WALLET_PRIVATE_KET>, l1provider);
const l1Tx = await client.depositEth(signer, utils.parseEther("0.00001"));
// Wait for the deposit to be completed on L2
const l2Receipt = await client.waitRelayToL2(tx, l1provider, l2provider);
```

## Boba Bridge Client

```ts
// Initialize the L1 and the L2 Web3 Providers
const l1provider = ethers.getDefaultProvider(<L1_RPC_URL>);
const l2provider = ethers.getDefaultProvider(<L2_RPC_URL>);
const client = new BobaBridgeClient();
// Signer who makes the deposit. Construct it using ethers or use the signer provided by Metamask
const signer = new Wallet(<WALLET_PRIVATE_KET>, l1provider);
const l1Tx = await client.depositEth(signer, utils.parseEther("0.0001"));
// Wait for the deposit to be completed on L2
const l2Receipt = await client.waitRelayToL2(tx, l1provider, l2provider);
```
