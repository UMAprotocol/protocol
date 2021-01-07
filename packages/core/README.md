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
