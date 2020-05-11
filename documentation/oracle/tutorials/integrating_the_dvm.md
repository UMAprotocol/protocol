# Integrating the DVM

## Toy Integration Example

This example will set up a `DepositBox` contract which custodies a user’s ERC-20 token balance.
On a local testnet blockchain, the user will deposit ETH into the contract and withdraw ETH corresponding to a desired USD amount.

The user links the `DepositBox` with one of the price identifiers enabled on the DVM.
In this example, the user will deposit ETH into the `DepositBox` and register it with the "ETH-USD" price identifier.
The user can now withdraw a "USD"-denominated amount of "ETH" from their `DepositBox` via smart contract calls.
The feature introduced by the DVM is on-chain pricing of the user's ERC-20 balance.
In this example, the user would not have been able to transfer "USD"-denominated amounts of "ETH" without referencing an off-chain "ETH-USD" price feed.
The DVM therefore enables the user to "pull" a reference price.

While the example below uses ETH as the currency for deposits to the `DepositBox` and ETH/USD as the price identifier, the code supports use of any ERC-20 token as the currency for deposits.
The code can also be deployed with other price identifiers.
For example, if users wanted to denominate their withdrawals in BTC instead of USD, the price identifier could be set to ETH/BTC.

Note that this toy example would perform poorly as a mainnet product, given the long period of time it would take for the UMA DVM to return the corresponding amount of ETH.
This example is intended to serve as a technical tutorial for how to integrate the DVM into a project.
Moreover, the DepositBox user would be paying for the privilege of having the DVM help them withdraw USD denominated ETH deposits.

The `DepositBox` contract will pay regular fees to the DVM proportional to the amount of collateral deposited into the contract. Additionally, whenever a user makes a withdrawal request, the contract will pay a fixed final fee to the DVM.

<!-- TODO: Add link
Details on these two fees are available [here](../economic_architecture.md).
-->

## Toy Integration Tutorial

1. Ensure that you have followed all the prerequisites [here](../../synthetic_tokens/tutorials/prerequisites.md).
2. Migrate the contracts by running the following command:

```bash
$(npm bin)/truffle migrate --network test
```

3. From the `/core` directory, run the following script to deploy the `DepositBox` contract:

```bash
$(npm bin)/truffle exec ./scripts/demo/DepositBox.js --network test
```

You should see the following output:

```
1. Deploying new DepositBox
 - Using WETH as collateral token
 - Pricefeed identifier for ETH/USD is whitelisted
 - Deployed a MockOracle
 - Deployed a new DepositBox and linked it with the MockOracle
2. Registering DepositBox with DVM
 - Granted DepositBox contract right to register itself with DVM
 - DepositBox is registered
3. Minting ERC20 to user and giving DepositBox allowance to transfer collateral
 - Converted 1000 ETH into WETH
 - User's WETH balance: 5800
 - Increased DepositBox allowance to spend WETH
 - Contract's WETH allowance: 1000
4. Depositing ERC20 into the DepositBox
 - Deposited 200 WETH into the DepositBox
 - User's deposit balance: 200
 - Total deposit balance: 200
 - User's WETH balance: 5600
5. Withdrawing ERC20 from DepositBox
 - Submitted a withdrawal request for 10000 USD of WETH
 - Resolved a price of 200 WETH-USD
 - User's deposit balance: 150
 - Total deposit balance: 150
 - User's WETH balance: 5650
```
