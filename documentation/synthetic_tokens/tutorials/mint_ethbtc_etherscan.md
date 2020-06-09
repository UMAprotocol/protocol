# Minting ETHBTC Synthetic Tokens via Etherscan

This article will walk you through minting ETHBTC tokens for the first time on Etherscan’s contract interaction GUI. If you already have a position (i.e. if you’ve already minted tokens, these steps may not apply to you).

You can already mint tokens via the [CLI tool](./using_the_uma_sponsor_cli_tool.md), but you may prefer to interact with the contract more directly via Etherscan. All you’ll need is some DAI to use as collateral (50 DAI should be enough) and ETH to pay for transaction gas (0.05 ETH should be enough).

## Before we begin: DAI approval

The ETHBTC token minting contract needs approval to transfer DAI (the collateral currency) on your behalf. To do that, follow these instructions:

1. Go to the [Write Contract Tab](https://etherscan.io/address/0x6b175474e89094c44da98b954eedeac495271d0f#writeContract) on the [DAI](https://etherscan.io/token/0x6b175474e89094c44da98b954eedeac495271d0f) contract page.
2. Search for the `approve` function.
3. For the first argument, pass in the address of the ETHBTC token minting contract: `0x3f2d9edd9702909cf1f8c4237b7c4c5931f9c944`.
4. For the second argument, pass in the maximum amount of collateral you intend to supply or alternatively any sufficiently high number.
   - This will be in units of Wei; use this [converter](http://eth-converter.com/).
   - For example, 100 DAI would be a value of `100000000000000000000`.
5. Hit write, and confirm the transaction through your wallet. Once the transaction is mined, your allowance is now set.
6. You can confirm this by going to the [Read Contract Tab](https://etherscan.io/address/0x6b175474e89094c44da98b954eedeac495271d0f#readContract) and looking for the `allowance` function.
7. Pass in your own address as the first argument and the ETHBTC token minting contract address (from Step 3 above) as the second argument.
8. Hit Query and confirm that you get the resulting DAI allowance you just set.

## Three considerations for minting tokens

There are three things we need to be concerned about when minting tokens for the first time (note that this is a little different if you have an existing position):

1. Meeting the Global Collateralization Ratio (GCR);
2. Minting the minimum required number of tokens, and;
3. Supplying the minimum required amount of collateral.

Once we have determined the values for these three items, then we will be ready to mint some tokens!

### Computing for the GCR

**The GCR is defined as the ratio of total collateral to the total number of tokens outstanding (i.e. GCR = total collateral / total tokens)** and we can only mint tokens if we collateralize enough to keep the GCR at its current level or higher.

To compute that, we need the true total collateral amount, and this we get from multiplying the “raw collateral” amount with a “cumulative fee multiplier”. This multiplier allows us to account for any fees that belong to the Oracle’s `Store` contract.

This process can seem a little intimidating, but rest assured that it gets a lot easier after this step.

These instructions will compute for the GCR:

1. Go to the [Read Contract Tab](https://etherscan.io/address/0x3f2d9edd9702909cf1f8c4237b7c4c5931f9c944#readContract) on the [ETHBTC token minting contract](https://etherscan.io/address/0x3f2d9edd9702909cf1f8c4237b7c4c5931f9c944) page.
2. Search for the `cumulativeFeeMultiplier` function and observe the number there. This is in units of Wei so you will again need to convert it back into a human-readable number with the converter above. For example, a value of `1000000000000000000` would equate to **a multiplier with the value of `1`**.

   ![multiplier](mint_multiplier.png)

3. Next search for the `rawTotalPositionCollateral` function and observe the number there. Multiply this number with the multiplier above to get the true total collateral amount. In this example, the resulting **total collateral amount is `68939980252164664648765`, or ~`68,939` when converted from Wei**.

   ![raw total position collateral](mint_raw_collateral.png)

4. Next, search for the `totalTokensOutstanding` function and observe the number there. In this example the **total number of tokens outstanding is `2089090310671656504456548` or ~`2,089,090` when converted from Wei**.

   ![total tokens outstanding](mint_tokens_outstanding.png)

5. The GCR is simply a ratio of these two numbers (i.e. total collateral / total tokens outstanding), so in our example: **GCR = 68939 / 2089090 = ~0.033**

### Minimum number of tokens to mint

There is a setting in the contract that defines the minimum number of tokens your position must have. For ETHBTC, this value is set at 1000 tokens, but if you wanted to confirm this on Etherscan, you can follow these instructions:

1. Go to the [Read Contract Tab](https://etherscan.io/address/0x3f2d9edd9702909cf1f8c4237b7c4c5931f9c944#readContract) on the [ETHBTC token minting contract](https://etherscan.io/address/0x3f2d9edd9702909cf1f8c4237b7c4c5931f9c944) page.
2. Search for the `minSponsorTokens` function and observe the number there. In this example, a value of `1000000000000000000000` or **`1000` tokens when converted from Wei**.

   ![min sponsor tokens](mint_min_sponsor_tokens.png)

This means that by the end of your minting transaction, you would need to make sure that you would have minted a total of 1000 tokens outstanding.

### Minimum amount of collateral required

Since the `GCR = total collateral / total tokens`, in order to maintain the GCR while minting the minimum amount of tokens, we simply multiply the number of tokens we want to mint with the GCR to find the required amount of collateral.

Assuming we want to mint 1000 tokens, that would mean we need **`1000 * GCR (~0.33) = ~33 DAI` of collateral**.

## Minting the actual tokens

Finally, we are ready to mint our actual ETHBTC tokens! You might want to add a bit more collateral than the minimum to prevent yourself from being liquidated (the minimum collateralization ratio for ETHBTC is 120%).

1. Go to the [Write Contract Tab](https://etherscan.io/address/0x3f2d9edd9702909cf1f8c4237b7c4c5931f9c944#writeContract) on the [ETHBTC token minting contract](https://etherscan.io/address/0x3f2d9edd9702909cf1f8c4237b7c4c5931f9c944) page.
2. Search for the `create` function.
3. For the first argument, input the collateral amount in Wei wrapped in double-quotes and square brackets. For example, 34 DAI of collateral would mean inputting `[“34000000000000000000”]`.
4. For the second argument, input the number of tokens (in Wei) that you want to mint, and wrap it in double-quotes with square brackets just like above. \

![create](images/image5.png "image_tooltip")

5. Hit write, and confirm the transaction through your wallet. Once the transaction completes, you should have minted your tokens. The Etherscan page for that transaction should look something like this: \

![etherscan_result](images/image6.png "image_tooltip")

### Checking your position

Now that we have minted our tokens, let’s check the smart contract to make sure it’s keeping tracking of our tokens and collateral properly.

1. Go to the [Read Contract Tab](https://etherscan.io/address/0x3f2d9edd9702909cf1f8c4237b7c4c5931f9c944#readContract) on the [ETHBTC token minting contract](https://etherscan.io/address/0x3f2d9edd9702909cf1f8c4237b7c4c5931f9c944) page.
2. Search for the `positions` function.
3. Paste in your address into the textbox and hit Query.
4. You should see something like the following: \

![positions](images/image7.png "image_tooltip")

From this, we can conclude that we have minted 1000 tokens with 38 DAI of collateral supplied.

## What next?

Now that you have minted your tokens, you need to make sure that it stays collateralized as the ETHBTC ratio moves. You can do this with the Sponsor [CLI tool](./using_the_uma_sponsor_cli_tool.md) that helps you manage your position. In the future, we might provide a dapp frontend for your convenience. Let us know on our Discord if you want to see this.

And don’t forget that, in order to get short exposure, you have to actually sell these ETHBTC tokens rather than just hold onto them. You can trade these tokens on Uniswap [here](https://uniswap.exchange/swap?inputCurrency=0x6b175474e89094c44da98b954eedeac495271d0f&outputCurrency=0x6d002a834480367fb1a1dc5f47e82fde39ec2c42). These tokens will expire on August 1st, 2020 (and become redeemable). So make sure to keep that in mind as well.
