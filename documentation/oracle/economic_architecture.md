# UMA DVM Architecture

The economic architecture of the UMA DVM is summarized here, and additional details can be found in the [whitepaper](https://github.com/UMAprotocol/whitepaper/blob/master/UMA-DVM-oracle-whitepaper.pdf).

This section provides an overview of the current implementation of the economic guarantees of the DVM. For a discussion of the guiding principles behind designing the economic guarantees of the DVM, please look at [this section](../getting_started/uma_oracle_design.md).

## Economic Guarantees of the UMA DVM

UMA looks at the potential profit from corruption (PfC) and cost of corruption (CoC) of contracts in the system and has designed a mechanism to ensure that the cost of corrupting the DVM will exceed the potential profit.
In doing so, we eliminate the economic incentives for corrupting the DVM in the first place.

This is a 3 step process:

1. Create a system to measure the Cost of Corruption (CoC)
2. Create a system to measure the Profit from Corruption (PfC)
3. Design a mechanism to keep CoC > PfC and prove it will work

## Current Implementation

The current implementation of this mechanism is a simpler version of the vision described in the sources above.

Currently, \$UMA tokenholders manually observe the PfC and CoC.

### Step 1: Measuring CoC

The CoC is the cost of corruption, i.e. how much it would cost someone to change the price that the DVM provides in response to a price request.

Since you would need >50% of the participating voting tokens for any given round of voting to control the DVM output, the CoC is roughly equal to the cost to control 50% of the participating UMA tokens.

### Step 2: Measuring PfC

The system-wide PfC is the sum of the PfC of each financial contract that is registered with the DVM.
The PfC of an individual financial contract is the maximum profit an attacker could make if they had full control of the DVM and the prices it returns to that financial contract.
Each smart contract that is registered with the DVM is responsible for computing their PfC values and exposing a `pfc()` method so others can read it.
This PfC value is reported to the DVM whenever fees are paid, since the fee amount is a function of the PfC value.

To calculate the PfC for the overall DVM system, the system sums the PfC values computed and reported by each individual financial contract.

### Step 3: Maintaining CoC > PfC

The DVM collects two types of fees from registered financial contracts, a “regular fee” and a “final fee”.
Each financial contract must report its PfC in terms of its single collateral currency.

The regular fee is paid periodically by financial contracts (generally whenever someone interacts with them).
They are calculated based on the PfC, the amount of time since they last paid them, and the current fee rate. The exact formula used can be found in the `computeRegularFee` function of the `Store` contract [here](https://docs.umaproject.org/uma/contracts/Store.html#Store-computeRegularFee-uint256-uint256-struct-FixedPoint-Unsigned-).
These fees are paid into the `Store` contract.
$UMA-holders control which address has `Withdrawer` privilege from the `Store`. 
The owner of the `Withdrawer` privilege uses the funds from the `Store` to perform “buy and burn” operations on the $UMA tokens to maintain CoC > PfC.

The “final fee” is paid to the `Store` each time that a financial contract makes a price request from the DVM.
The “final fee” is a fixed amount for each collateral type.

Currently, \$UMA tokenholders must manually observe the PfC and CoC to determine the regular and final fee rates.
The rates should generally go up as the CoC > PfC inequality comes closer to being violated.
Higher fees slightly reduce the PfC since the collateral is pulled from the contracts to put into the Store, and the Risk Labs Foundation regularly withdraws the fees that have collected in the `Store` and uses them to “buy and burn” UMA tokens to increase the CoC.

Fee rates, as well as other parameters relating to the DVM, are established via on-chain governance by \$UMA token holders via the [UMIP process](./governance/UMIPs.md).

## Additional Research

For more detailed research on potential mechanisms that can be implemented, please look at this [repo](https://github.com/UMAprotocol/research).
