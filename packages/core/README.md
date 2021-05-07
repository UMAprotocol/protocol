# @uma/core

This package contains contract artifacts for all UMA smart contracts.

## Installing the package

```bash
yarn add @uma/core
```

## Importing artifacts directly

The easiest way to import contracts is to do so by importing the file from
`@uma/core/build/contracts/ContractName.json`. This is especially useful in certain contexts where imports cannot be
dynamically loaded (generally non-nodejs contexts):

```js
import { abi as expiringMultiPartyAbi } from "@uma/core/build/contracts/ExpiringMultiParty.json"
import VotingArtifact from "@uma/core/build/contracts/Voting.json"

// Grab the mainnet voting address.
const networkId = 1
const mainnetVotingAddress = VotingArtifact.networks[networkId].address
```

## Importing Artifacts via index.js

Helper methods are available for importing artifacts in nodejs:

```js
const { getAbi, getAddress, getTruffleContract } = require("@uma/core")

// Grabs the EMP abi.
const expiringMultiPartyAbi = getAbi("ExpiringMultiParty")

// Gets the address of the mainnet Voting contract.
const mainnetVotingAddress = getAddress("Voting", 1)

// Initializes a truffle contract instance for the Governor contract.
// web3 should be initialied and connected to a node.
const Web3 = require("web3")
const web3 = new Web3("your.node.url.io")
const Governor = getTruffleContract("Governor", web3)
const governor = await governor.deployed()
```

## Advanced Usage

Older core abis and addresses are available by specifying a version string. The following example does exactly the same
as the above, but it dynamically grabs contract artifacts from version 1.1.0 rather than the imported version of the
package:

```js
const { getAbi, getAddress, getTruffleContract } = require("@uma/core");

// Grabs the EMP abi.
const expiringMultiPartyAbi = getAbi("ExpiringMultiParty", "1.1.0");

// Gets the address of the mainnet Voting contract.
const mainnetVotingAddress = getAddress("Voting", 1, "1.1.0');

// Initializes a truffle contract instance for the Governor contract.
// web3 should be initialied and connected to a node.
const Web3 = require("web3");
const web3 = new Web3("your.node.url.io");
const Governor = getTruffleContract("Governor", web3, "1.1.0");
const governor = await governor.deployed();
```

Note: this use case is not particularly common, but it is sometimes useful to have access to multiple abi versions
side-by-side.

## Deployment with Hardhat

Here is a list of scripts you can execute:

`yarn void:deploy`

This will deploy your contracts on the in-memory hardhat network and exit, leaving no trace. Quickest way to ensure that deployments work as intended without consequences.

`yarn hardhat deploy --network <NETWORK-NAME>`

Deploy all contracts. Requires a `CUSTOM_NODE_URL` HTTP(s) endpoint and a `MNEMONIC` to be set in environment. Available tags can be found in `/deploy` scripts, and available networks are found in the `networks` object within `hardhat.config.js`.

`./scripts/hardhat/deployContracts.sh beacon-l2 <NETWORK-NAME>`

Deploys contracts necessary to set up Beacon Oracle on L2 on the network, which would be used to deploy to Polygon for
example.

`./scripts/hardhat/deployContracts.sh beacon-l1 <NETWORK-NAME>`

Deploys contracts necessary to set up Beacon Oracle on L1 on the network, which would be deployed on Mainnet for
example.

`./scripts/hardhat/verifyDeployedContracts.sh <NETWORK-NAME>`

Verify contracts for selected network on Etherscan. Requires an `ETHERSCAN_API_KEY` to be set in environment.

`./scripts/hardhat/setupDeployedContracts.sh beacon-l2 <NETWORK-NAME>`

Run this after deploying and verifying the contracts on a public network in order to set up important contract state such as the Finder, Registry, and more. The first argument is the same type of argument passed into the `deployContracts.sh`
script which informs it which contracts to set up. For example, `beacon-l1` will set up the `SourceOracle` while
`beacon-l2` will set up the `SinkOracle`.

## Typescript!

In addition to the above import styles, you can import typescript types for truffle, ethers, and web3. Because of existing
limitations in typechain the import style for each of these is slightly different.

Note: this is a work in progress and the typescript API will likely change and improve in the future.

### Ethers

The best support is for Ethers contract types. To construct an Ethers contract, simply import from the ethers factories:

```ts
import { Voting__factory } from "@uma/core/contract-types/ethers"

// Alternative import style to avoid loading anything unnecessary
// import { Voting__factory } from "@uma/core/contract-types/ethers/factories/Voting__factory"

const provider = new ethers.providers.JsonRpcProvider(RPC_HOST)
const votingInstance = Voting__factory.connect(VOTING_ADDRESS, provider)
```

If you just want the raw type, you can import as follows:

```ts
import type { Voting } from "@uma/core/contract-types/ethers";

// Alternative import styles
// import type { Voting } from "@uma/core/contract-types/ethers/Voting";
```

### Truffle

Truffle has well-defined contract types as well, but there are no built-in truffle factories.

```ts
import type { VotingInstance, VotingContract } from "@uma/core/contract-types/truffle";

// Alternative import style
// import type { VotingInstance, VotingContract } from "@uma/core/contract-types/truffle/Voting";

import { getTruffleContract } from "@uma/core";

const Voting = getTruffleContract("Voting", web3) as VotingContract;
const voting = Voting.deployed(); // Should be a VotingInstance.
```

### Web3

Web3 types can be imported similarly to truffle. However, the import syntax is quite limited. There is no way to import
all UMA web3 types from the same import. Each contract is specified in a separate file.

```ts
import type { Voting } from "@uma/core/contract-types/web3/Voting";

const voting = new web3.eth.Contract(VOTING_ABI, VOTING_ADDRESS) as Voting;
```
