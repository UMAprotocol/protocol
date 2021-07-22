# @uma/contracts-frontend

This package exports all UMA smart contract artifacts specifically meant for consumption in a frontend. These exports
are specifically optimized for frontends so they are able to drop any unused artifacts in order to keep the bundle size
small.

## Installing the package

```bash
yarn add @uma/contracts-frontend
```

## Importing artifacts directly

To import artifacts directly into your tool of choice, the index file provides convenient functions for doing so:

```js
import { getVotingAbi, getVotingBytecode, getVotingAddress } from "@uma/contracts-frontend"

// Gets the abi object for the Voting contract.
// This will be needed to interact with the voting contract.
const votingAbi = getAbiVotingAbi()

// Gets the bytecode string for the voting contract.
// This should usually only be required if you need to deploy a voting contract (rare).
const votingBytecode = getVotingBytecode()

// Gets the address of the voting contract for chain id 1 (eth mainnet).
// If there is no single canonical deployment of a particular contract on the network provided, this will fail.
const chainId = 1
const votingAddress = getVotingAddress(chainId)
```

## Typescript!

Typescript is fully supported for all of the above operations:

```ts
import { getVotingAbi, getVotingBytecode, getVotingAddress } from "@uma/contracts-frontend";
...
```

In addition to artifact support, typescript types (and sometimes factories) are available for ethers and web3.

### Ethers

The best support is for Ethers contract types. To construct an Ethers contract, import one of the ethers factories:

```ts
import { VotingEthers__factory, getVotingAddress } from "@uma/contracts-frontend" // Factory to create ethers instance.
import type { VotingEthers } from "@uma/contracts-frontend" // Type for ethers instance.

const NETWORK_ID = 1
const VOTING_ADDRESS = getVotingAddress(NETWORK_ID)

// Note: the explicit type here isn't necessary -- this is just provided to document what VotingEthers is.
const votingInstance: VotingEthers = VotingEthers__factory.connect(VOTING_ADDRESS, providerOrSigner)
```

### Web3

Web3 factories are not provided, but web3 contract types are. They can be used as follows:

```ts
import type { VotingWeb3 } from "@uma/contracts-frontend"
import { getVotingAbi, getVotingAddress } from "@uma/contracts-frontend"

const VOTING_ABI = getVotingAbi()
const NETWORK_ID = 1
const VOTING_ADDRESS = getVotingAddress(NETWORK_ID)

const voting = new web3.eth.Contract(VOTING_ABI, VOTING_ADDRESS) as VotingWeb3
```
