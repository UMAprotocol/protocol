# Deployed DVM Contracts
Below is where you can find smart contract addresses for UMA-supported mainnet and testnet deployments of the DVM. 

## UMA Token Holders
If you are a UMA token holder, you will probably only interact with `Voting`, `Finder`, `DesignatedVotingFactory`, and `Governor`. 
These are the relevant contracts used to vote on price requests and UMIPs. 

## Financial Contract Developers

If you are building your own financial contract template, you will probably interact with `Store`, `Voting`, `Finder`, `IdentifierWhitelist`, and `Registry`. 
These contracts are used by the DVM to keep track of which financial contracts depend on it, how they impact the economic guarantee of the oracle, and which price identifiers UMA token holders need to be prepared to vote on. 

## Contract Addresses
* [Mainnet (network id: 1)](https://github.com/UMAprotocol/protocol/blob/master/core/networks/1.json)
* [Rinkeby (network id: 4)](https://github.com/UMAprotocol/protocol/blob/master/core/networks/4.json)
* [Kovan (network id: 42)](https://github.com/UMAprotocol/protocol/blob/master/core/networks/42.json)

# Deployed Synthetic Tokens
You can also find a list of supported deployments of the priceless synthetic token contract template on various networks. 

## Kovan (network id: 42)

* Synthetic gold tokens expiring Friday, May 1, 2020 12:00:00 AM GMT: [0x16a4979e29c5cd4d92168d8e88c69ffa3eb11fbf](https://kovan.etherscan.io/token/0x16a4979e29c5cd4d92168d8e88c69ffa3eb11fbf)
* Synthetic gold tokens expiring Monday, June 1, 2020 12:00:00 AM GMT: [0xce7bc313c38f0f79e4df43cb5500c22134e139c5](https://kovan.etherscan.io/token/0xce7bc313c38f0f79e4df43cb5500c22134e139c5)
