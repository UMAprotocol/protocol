## Change Final Fee Proposal Scripts

This README file will guide you on how to run the scripts to propose and verify transactions to whitelist and update the final fee for any ERC20 token in AddressWhitelist and Store contracts on mainnet and supported L2 chains.

## 1. Propose Fee Changes

This script creates a proposal to whitelist and update the final fee for each ERC20 token defined in the configuration.

To run the proposal script:

1.  Fork mainnet into a local hardhat node by running:

    `HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy`

2.  Run setup fork script from the root of the repo:

    `./packages/scripts/setupFork.sh`

3.  Execute the proposal script with the new fee values and node URLs:

```
    PROPOSAL_TITLE=<PROPOSAL_TITLE> \
    NODE_URL_1=<MAINNET-NODE-URL> \
    NODE_URL_10=<OPTIMISM-NODE-URL> \
    NODE_URL_137=<POLYGON-NODE-URL> \
    NODE_URL_42161=<ARBITRUM-NODE-URL> \
    TOKENS_TO_UPDATE='{"USDC":{"finalFee":"250.00","mainnet":"0x123","polygon":"0x123","arbitrum":"0x123"}}' \
    yarn hardhat run ./src/admin-proposals/change-final-fee/0_Propose.ts --network localhost
```

`TOKENS_TO_UPDATE` is a JSON string.
Each token is identified by its ticker (e.g., USDC) just to reference the token in the JSON string.
For each token, you have to specify:

- finalFee: The new fee value to be set in all the networks specified.
- Network-specific addresses (e.g., mainnet, polygon, arbitrum, optimism).

Example:

```
    TOKENS_TO_UPDATE='{"USDC":{"finalFee":"250.00","mainnet":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","polygon":"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359","arbitrum":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","optimism":"0x0b2c639c533813f4aa9d7837caf62653d097ff85"}}'
```

1. Run the simulate vote script

   `yarn hardhat run ./src/admin-proposals/simulateVoteV2.ts --network localhost`

## 2. Verify Mainnet Changes

This script verifies that the new final fee has been correctly configured in the mainnet.

To run the verification script on a local hardhat node fork of the mainnet or directly on the mainnet:

Execute the verification script with the updates configuration and node URL:

```
    NODE_URL_1=<MAINNET-NODE-URL> \
    TOKENS_TO_UPDATE='{"USDC":{"finalFee":"250.00","mainnet":"0x123","polygon":"0x123","arbitrum":"0x123"}}' \
    yarn hardhat run ./src/admin-proposals/change-final-fee/1_Verify.ts --network localhost
```

## 3. Verify L2 Chains Changes

This script verifies that the new final fee has been correctly configured in the L2 chains. It can be run on forks directly on the mainnets to verify.

To run the script:

```
    FORK_NETWORK=true \
    NODE_URL_10=<OPTIMISM-NODE-URL> \
    NODE_URL_137=<POLYGON-NODE-URL> \
    NODE_URL_42161=<ARBITRUM-NODE-URL> \
    TOKENS_TO_UPDATE='{"USDC":{"finalFee":"250.00","mainnet":"0x123","polygon":"0x123","arbitrum":"0x123"}}'
    PROPOSAL_DATA=<PROPOSAL_DATA> \
    yarn hardhat run ./src/admin-proposals/change-final-fee/2_VerifyRelays.ts
```
