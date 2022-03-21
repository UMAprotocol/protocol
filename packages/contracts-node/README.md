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
import { getAbi, getAddress, getBytecode } from "@uma/contracts-node"

const VOTING_ABI = getAbi("Voting")
const NETWORK_ID = 1
const VOTING_ADDRESS = getAddress("Voting", NETWORK_ID)

// Create a voting instance to represent a pre-deployed voting contract.
const voting = new web3.eth.Contract(VOTING_ABI, VOTING_ADDRESS) as VotingWeb3

// Or you can create a new voting instance using the bytecode.
const VOTING_BYTECODE = getBytecode("Voting")
const newVotingInstance = (await new web3Instance.eth.Contract(VOTING_ABI, undefined)
  .deploy({ data: VOTING_BYTECODE, arguments: VOTING_ARGS })
  .send({ from: YOUR_ADDRESS })) as VotingWeb3
```

## Testing

This package works well with hardhat test. If you use hardhat-deploy to set up deployments in hardhat, `getAddress`
should recognize them.

```js
// Note: if running directly from node rather than inside hardhat, you will need to manually set global.hre.
// @uma/contracts-node uses the global object to detect hardhat. For hardhat tests, this step should be
// unnecessary.
global.hre = require("hardhat");
const { getAddress } = require("@uma/contracts-node");

...
// hre.deployments.deploy deploys and saves the deployment.
await hre.deployments.deploy("Voting", { args: YOUR_ARGS, from: YOUR_ADDRESS });

// To add an address deployed without .deploy
// hre.deployments.save("Voting", { address: VOTING_ADDRESS, abi: VOTING_ABI });

// Address should be pulled out as expected.
const address = getAddress("Voting", parseInt(await hre.getChainId()));
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
- Add similar `include` and `exclude` paths for your package's artifacts in the `tsconfig.json` as exist for
  `@across-protocol/contracts`.
