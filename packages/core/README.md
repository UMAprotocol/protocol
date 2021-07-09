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

Here is a list of scripts you can execute to take full advantage of `hardhat`'s succinct deployment and verification
process:

This will deploy your contracts on the in-memory hardhat network and exit, leaving no trace. Quickest way to ensure that deployments work as intended without consequences.

`yarn hardhat deploy`

Deploy all contracts to specified network. Requires a `CUSTOM_NODE_URL` HTTP(s) endpoint and a `MNEMONIC` to be set in environment. Available contract tags can be found in `/deploy` scripts, and available networks are found in the `networks` object within `hardhat.config.js`. Tags can be powerful, for example running `yarn hardhat deploy --tags Bridge` will only deploy the Bridge contract its dependencies (such as the Finder).

`yarn hardhat deploy --network <NETWORK-NAME> --tags <TAGS>`

Deploys all production DVM contracts, which doesn't include the `MockOracle` or BeaconOracles for example.

`yarn hardhat deploy --tags dvm`

Verify contracts for selected network on Etherscan. Requires an `ETHERSCAN_API_KEY` to be set in environment. This script requires that the local `./core/deployments` has solc standard-input json files, which will be generated after running the `deploy` command.

`yarn hardhat etherscan-verify --license AGPL-3.0 --force-license --network <NETWORK-NAME>`

Export deployed contract data such as ABI and addresses to `deployed.json` in order to make data available for a front-end client, for example. For example, a newly deployed `Finder` address on Rinkeby can be imported via `deployed.4.rinkeby.contracts.Finder.address`.

`yarn hardhat export --export-all ./networks/hardhat/deployed.json`

The following commands are implemented as [hardhat tasks](https://hardhat.org/guides/create-task.html) that make it easy to interact with deployed contracts via the CLI:

Registers the `deployer` account (as defined in the `namedAccounts` param in `hardhat.config.js`) with the deployed Registry for the network. Optionally registers a custom account.

`yarn hardhat register-accounts --network <NETWORK-NAME> --account <CUSTOM-ACCOUNT>`

Whitelist hardcoded identifiers from the `config/identifiers.json` file. Optionally whitelists a custom identifier.

`yarn hardhat whitelist-identifiers --network <NETWORK-NAME> --id <CUSTOM-IDENTIFIER>`

Sets specified contracts in the deployed Finder. More contracts available to be set can be found in the `common/hardhat/tasks/finder.js` script.

`yarn hardhat setup-finder --network <NETWORK-NAME> --registry --bridge --generichandler`

## Typescript!

In addition to the above import styles, you can import typescript types for truffle, ethers, and web3. Because of existing
limitations in typechain the import style for each of these is slightly different.

Note: this is a work in progress and the typescript API will likely change and improve in the future.

### Ethers

The best support is for Ethers contract types. To construct an Ethers contract in node, simply import from the ethers factories:

```ts
import { EthersContracts } from "@uma/core"
const provider = new ethers.providers.JsonRpcProvider(RPC_HOST)
const votingInstance = EthersContracts.Voting__factory.connect(VOTING_ADDRESS, provider)

// Raw type rather than the factory.
import type { EthersContracts } from "@uma/core"
const { Voting } = EthersContracts
```

### Truffle

Truffle has well-defined contract types as well, but there are no built-in truffle factories.

```ts
import type { TruffleContracts } from "@uma/core/contract-types/truffle"
const { VotingInstance, VotingContract } = TruffleContracts

import { getTruffleContract } from "@uma/core"

const Voting = getTruffleContract("Voting", web3) as VotingContract
const voting = Voting.deployed() // Should be a VotingInstance.
```

### Web3

Web3 types can't be imported directly from the index file. However, if you are able to import via path, you can import
this way:

```ts
import type { Voting } from "@uma/core/contract-types/web3/Voting"

const voting = new web3.eth.Contract(VOTING_ABI, VOTING_ADDRESS) as Voting
```
