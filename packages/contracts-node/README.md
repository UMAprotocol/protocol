# @uma/contracts-node

This package exports all UMA smart contract artifacts specifically meant for consumption in nodejs.

## Installing the package

```bash
yarn add @uma/contracts-node
```

## Importing artifacts directly

To import artifacts directly into your tool of choice, the index file provides convenient functions for doing so:

```js
const { getAbi, getBytecode, getAddress } = require("@uma/contracts-node")

// Gets the abi object for the Voting contract.
// This will be needed to interact with the voting contract.
const votingAbi = getAbi("Voting")

// Gets the bytecode string for the voting contract.
// This should usually only be required if you need to deploy a voting contract (rare).
const votingBytecode = getBytecode("Voting")

// Gets the address of the voting contract for chain id 1 (eth mainnet).
// If there is no single canonical deployment of a particular contract on the network provided, this will fail.
const chainId = 1
const votingAddress = getAddress("Voting", chainId)
```

## Typescript!

Typescript is fully supported for all of the above operations:

```ts
import { getAbi, getBytecode, getAddress } from "@uma/contracts-node";
...
```

In addition to artifact support, typescript types (and sometimes factories) are available for ethers and web3.

### Ethers

The best support is for Ethers contract types. To construct an Ethers contract, import one of the ethers factories:

```ts
import { VotingEthers__factory, getAddress } from "@uma/contracts-node" // Factory to create ethers instance.
import type { VotingEthers } from "@uma/contracts-node" // Type for ethers instance.

const NETWORK_ID = 1
const VOTING_ADDRESS = getAddress("Voting", NETWORK_ID)

// Note: the explicit type here isn't necessary -- this is just provided to document what VotingEthers is.
const votingInstance: VotingEthers = VotingEthers__factory.connect(VOTING_ADDRESS, providerOrSigner)
```

### Web3

Web3 factories are not provided, but web3 contract types are. They can be used as follows:

```ts
import type { VotingWeb3 } from "@uma/contracts-node"
import { getAbi, getAddress } from "@uma/contracts-node"

const VOTING_ABI = getAbi("Voting")
const NETWORK_ID = 1
const VOTING_ADDRESS = getAddress("Voting", NETWORK_ID)

const voting = new web3.eth.Contract(VOTING_ABI, VOTING_ADDRESS) as VotingWeb3
```
