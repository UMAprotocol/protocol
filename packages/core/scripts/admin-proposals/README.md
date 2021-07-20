# Admin Proposal Helper Scripts

This folder contains scripts that facilitate the testing of proposing admin price requests to the DVM. Admin proposals are the final step in the [UMIP](https://docs.umaproject.org/uma-tokenholders/umips) process, which is how UMA token holders govern the UMA protocol.

# Mainnet fork

These scripts are expected by default to run against a local (hardhat) [Mainnet fork](https://hardhat.org/guides/mainnet-forking.html) in order to test that the DVM contract state is modified as expected following a [simulated vote](https://docs.umaproject.org/uma-tokenholders/uma-holders#voting-on-price-requests). The local node should be set to run on port `9545`.

After the developer has tested against the local Mainnet fork, they can use the same script to submit the Admin proposal on-chain against the public Ethereum network. Usually this would involve passing the `--network` flag to the script and other supporting flags like `--keys`. These flags are neccessary because `common/ProviderUtils/getWeb3` is used for production.

# How to run

Scripts are designed to be run as `node` scripts.

For testing locally against a mainnet fork, the `HARDHAT_NETWORK=localhost` environment variable must be set so that we can [impersonate accounts](https://hardhat.org/guides/mainnet-forking.html#impersonating-accounts) on the local fork. For example: `HARDHAET_NETWORK=localhost node ...`.

For running scripts in production, `HARDHAT_NETWORK` is not required to be set because `web3` is injected by the aformentioned `getWeb3` function. For this to work, the `CUSTOM_NODE_URL` environment variable needs to be set and the `--network` flag should be passed in to the `node` script. For example: `node ... --network mainnet_gckms --keys deployer`.

# Relaying governance to Polygon

Admin proposals can be relayed from Ethereum to Polygon like in [this example](https://github.com/UMAprotocol/protocol/blob/349401a869e89f9b5583d34c1f282407dca021ac/packages/core/test/polygon/e2e.js#L221). This just requires that the `POLYGON_NODE_URL` is set so that the script can also query network information from Polygon.
