# Using the UMA Sponsor CLI Tool

The Sponsor CLI tool lets you interact with a synthetic token contract.
In this tutorial, you’ll be deploying a synthetic token contract to a local testnet and interacting with it via the Sponsor CLI tool.

It will let you be the “Token Sponsor,” which lets you:

- Deposit collateral and borrow synthetic tokens
- Manage your position’s collateral (deposit/withdraw)
- Redeem the borrowed synthetic tokens and get collateral back
- Transfer your position to another Ethereum address

This [video](https://www.crowdcast.io/e/defi-discussions/18) will walk through the steps of this tutorial, starting around minute 11:00.

## Signing Account

The CLI assumes that `accounts[0]`, the first account linked to the `web3` object injected into Truffle, is the sponsor
account and will sign all transactions using its private keys.

## Prerequisites

Before beginning this tutorial, please make sure your environment is set up correctly by following the instructions in the [Prerequisites](prerequisites.md). After completing this section, you should:

- Have the protocol repo cloned.
- Be running an instance of Ganache on port 9545.
- Have run truffle compilation for the contracts in `core/`.

There is just one more additional step before the tutorial can begin. At the project root, symlink the CLI to your global directory. There are 2 ways to do this. Either run

```sh
npm link
```

OR

```sh
npm install -g ./
```

You may need to prefix these commands (`sudo npm link`) to run them.

## Launching the CLI tool

1. Navigate to the `/core` folder: `cd core`
2. If on Kovan testnet, apply network addresses:

```bash
npx apply-registry
```

3. Migrate the contracts:

```bash
npx truffle migrate --reset --network=test
```

4. Deploy a contract to create priceless synthetic tokens named “BTCUSD” (note this may have changed, this tutorial will be updated soon).
   Each synthetic token is an ERC-20 token that represents a synthetic bitcoin, collateralized by ETH. We should set
   the `--test` flag to `true` in order to whitelist the collateral currency, approve the pricefeed identifier, use
   `MockOracle` as our oracle, create an initial sponsor position, and mint our default sponsor account some collateral
   tokens. The CLI tool does not support creating the first position globally for an `ExpiringMultiParty` contract
   due to the GCR restriction, which you can read more about [here](../synthetic_tokens/explainer.md). In short,
   every position that is created must be collateralized above the global collateralization ratio (GCR) for the
   contract (aggregate collateral divided by aggregate synthetic tokens outstanding), but the first position
   globally has no GCR to reference. Therefore, the sponsor's flow is different enough that we do not address it in
   this iteration of the CLI.

```bash
npx truffle exec scripts/local/DeployEMP.js --network=test --test=true
```

This is the output you should see (the numbers might be slightly different):

![](deployEMP_output.png)

5. Run the CLI.

```bash
uma --network=test
```

This will show you the top-level menu of the CLI tool.

![](toplevelmenu.png)

## Navigate to Live Synthetic Tokens

Now that you can see the priceless synthetic token contract we will be interacting with, the CLI tool can be used to create additional synthetic tokens from this same contract.

From the top-level menu in the CLI tool, use the arrow keys to select “Sponsor” and press “Enter”.

![](toplevelmenu_sponsor.png)

View the live contracts to see a list of synthetic tokens on the network that are live (i.e. not yet expired).
Because there is only one deployed contract on this local testnet, only one is shown. Select this one by pressing “Enter”.

![](livemarket.png)

## Creating New Synthetic Tokens

Navigate to the list of live synthetic tokens. Because you are not yet a token sponsor for this synthetic token, you are prompted to “Sponsor new position”. Use the arrows to navigate to this option and press “Enter”. Enter the number of tokens you would like to create (1000 in this example, which is the
minimum sponsor position allowed as described by the configuration object in the `DeployEMP.js` script).

![](create_numtokens.png)

After displaying the required amount of collateral to create this position, you are prompted to confirm if you would like to proceed.

![](create_confirm.png)

A summary of the relevant transactions is displayed, as well as an updated summary of your token sponsor position.

![](create_complete.png)

## Depositing Additional Collateral

Navigate to the list of live synthetic tokens. Select the token contract for which you are a token sponsor. Here are the options available to help manage your token sponsor position:

![](deposit_options.png)

Navigate to “Deposit collateral” and press “Enter”.
Input the number of ETH you would like to deposit.

![](deposit_num.png)

After confirming the transaction, you will be presented with a summary of the transactions and an updated summary of your position.

![](deposit_complete.png)

## Withdrawing excess collateral

Navigate to the list of live synthetic tokens. Select the token contract for which you are a token sponsor. Navigate to “Withdraw collateral” and press “Enter”.

![](withdraw_toplevel.png)

Because you are the only token sponsor, you cannot make a “fast” withdrawal as explained [here](../synthetic_tokens/explainer.md).
Rather, this will be a “slow” delay. The request will take 60 minutes to process, as the liveness period for withdrawals has been set in this local testnet deployment to 60 minutes.
During this liveness period, the collateral in the contract is locked (a sponsor cannot add additional collateral or make another withdrawal request).
Request to withdraw some ETH. After submitting this request, a summary of the relevant transaction will be displayed, as well as an updated summary of your token sponsor position.
Note that the pending collateral withdrawal amount is now reflected.

![](withdraw_num.png)

Because time does not advance automatically on your local blockchain with Ganache, you should exit the Sponsor CLI tool and advance time manually with the following command. Manually modifying contract time is possible because we are using the `MockOracle` which allows us to manually push prices and modify contract time.
Running this script like so will advance time by 120 minutes.

```bash
npx truffle exec scripts/local/AdvanceEMP.js --network=test
```

Return to the Sponsor CLI tool with the following command.

```bash
uma --network=test
```

Navigate to the contract you previously used to create a synthetic token position.

Note that you have a pending withdrawal. Navigate to “Manage your withdrawal request” and press “Enter”.
Note that the withdrawal request is now ready to be executed.

![](withdraw_execute.png)

Navigate to “Execute Pending Withdrawal” and press “Enter”. After confirming, you are presented with a summary of the relevant transactions and your updated position summary.

![](withdraw_complete.png)

## Redeeming Synthetic Tokens

Navigate to the list of live synthetic tokens and select the contract for which you are a token sponsor. Navigate to “Repay tokens” and press “Enter”.

![](redeem_start.png)

You will now indicate how many tokens you would like to redeem. Each token is redeemable for the pro rata collateralization of each token by the token sponsor.
Only token sponsors are allowed to redeem tokens prior to their expiration. Before expiry, you are allowed to redeem as many tokens as you want provided that
you keep the tokens outstanding above the `minSponsorTokens` requirement which is default set to `1000` in the `DeployEMP.js` script. You may always redeem
100% of the tokens outstanding and simultaneously end the position.
After confirming, you will be presented with the relevant transactions and a summary of the updated token sponsor position.

![](redeem_complete.png)

## Transferring a Token Sponsor Position

Navigate to the list of live synthetic tokens and select the contract for which you are a token sponsor. Navigate to “Transfer position to new owner” and press “Enter”.
After confirming, your request to transfer the token sponsor position will be submitted. Just as with a withdrawal request, this request will have a liveness period of 60 minutes. (If transfers were instantaneous, a sponsor who is about to get liquidated would simply transfer their position to a different account, thereby avoiding (frontrunning) the liquidation. In theory, they could keep doing these transfers forever, never getting liquidated.)

Note that your summary indicates that there is a “Pending transfer request”.

![](transfer_start.png)

Because time does not advance automatically on your local blockchain with Ganache, you should exit the Sponsor CLI tool and advance time manually with the following command:

```bash
npx truffle exec scripts/local/AdvanceEMP.js --network=test
```

Return to the Sponsor CLI tool with the following command:

```bash
uma --network=test
```

Navigate to the contract you are a token sponsor for.

![](transfer_confirm.png)

Navigate to “Transfer position to new owner” and press “Enter”.
The Sponsor CLI tool indicates that the liveness period has elapsed and the request is ready to be executed.
Navigate to “Execute Pending Transfer” and press “Enter”. You will be prompted to enter the address to transfer the position to. In this demo, the position will be transferred to `0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828`.
After confirming, you will be notified that you are no longer a token sponsor.

![](transfer_complete.png)
