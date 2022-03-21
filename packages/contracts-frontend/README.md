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
import { getVotingAbi, getVotingAddress, getVotingBytecode } from "@uma/contracts-frontend"

const VOTING_ABI = getVotingAbi()
const NETWORK_ID = 1
const VOTING_ADDRESS = getVotingAddress(NETWORK_ID)

// Create a voting instance to represent a pre-deployed voting contract.
const voting = new web3.eth.Contract(VOTING_ABI, VOTING_ADDRESS) as VotingWeb3

// Or you can create a new voting instance using the bytecode.
const VOTING_BYTECODE = getVotingBytecode()
const newVotingInstance = (await new web3Instance.eth.Contract(VOTING_ABI, undefined)
  .deploy({ data: VOTING_BYTECODE, arguments: VOTING_ARGS })
  .send({ from: YOUR_ADDRESS })) as VotingWeb3
```

## Adding contracts from external packages

To add external package contracts, the external package must be set up in a particular way. Most of it is standard
hardhat, but a few exports must be added specifically.

### Requirements

The external package must export:

- All hardhat artifacts that it wants this package to re-export.
- Typechain types under `/typechain`. It must include web3 and ethers typechain exports.
- A special json file at the path `/build/artifacts.json` that describes the location of all hardhat artifacts. This
  JSON file is a simple json array of objects, each object having a field called `relativePath` that is the path from the
  root to each hardhat artifact. The artifact's filename must match the contract name.
- A folder at `/networks` following the same structure as `/packages/core/networks` in this repository for any
  contract addresses that it wants to add.

### Adding an external package

To add an external package:

- Add the external package name to the `EXTERNAL_PACKAGES` array in `/packages/common/hardhat/tasks/artifacts.ts`.
- Add the external package to this package as a `devDependency`.
- Copy the `copy-across-types` package.json script in this package replacing the name and `@across-protocol/contracts`
  with the new package.
- Add your new package.json script to the `generate-ts` script in package.json similar to how `copy-across-types` is.
