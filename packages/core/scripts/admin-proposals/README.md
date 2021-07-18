# Admin Proposal Helper Scripts

This folder contains scripts that facilitate the testing of proposing admin price requests to the DVM. Admin proposals are the final step in the [UMIP](https://docs.umaproject.org/uma-tokenholders/umips) process, which is how UMA token holders govern the UMA protocol.

# Mainnet fork

These scripts are expected by default to run against a local [Mainnet fork](https://hardhat.org/guides/mainnet-forking.html) in order to test that the DVM contract state is modified as expected following a [simulated vote](https://docs.umaproject.org/uma-tokenholders/uma-holders#voting-on-price-requests).

After the developer has tested against the local Mainnet fork, they can use the same script to submit the Admin proposal on-chain against the public Ethereum network. Usually this would involve passing the `--production` flag to the script.

# Hardhat

These scripts use the `hardhat` [runtime environment](https://hardhat.org/advanced/hardhat-runtime-environment.html) to interact with the Ethereum network.

# How to run

Scripts are designed to be run as `node` scripts. `node` scripts are preferred over `hardhat tasks` because there is more separation from other `hardhat` tasks such as `test`. For more details about `hardhat` tasks and scripts, go [here](https://ethereum.stackexchange.com/questions/83656/where-does-the-line-blur-between-a-task-and-a-script-in-hardhat).
