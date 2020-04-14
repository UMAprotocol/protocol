# Attack Vectors

Below is a list of known attack vectors to the proper collateralization of synthetic tokens deployed using this financial contract template. 
We’ve categorized and ranked the attack vectors by severity. 

Note that the financial contract template has an emergency shutdown feature that prematurely expires the contract. 
This can only be triggered by a vote approved by UMA token holders. 
Emergency shutdown prematurely expires the contract and the final resolution depends on a DVM price, which could take 2-4 days to arrive.

## Attack vectors affecting incentives to liquidate:
### Declining liquidator incentives
* Scenario: In the event of a successful liquidation, the liquidator receives all collateral deposited by the token sponsor, proportional to the size of the position being liquidated. 
As a result, the reward for a liquidator decreases as a token sponsor’s position becomes more undercollateralized. 
Eventually, if the position is collateralized by < 100%, there is no incentive to liquidate.
* Solution: Bots should be performant enough that they can capture the  maximum profit from liquidation before the price moves too far. 
Additionally, UMA will liquidate token sponsors uneconomically early on to support the development of synthetic tokens. 
In a large market, liquidations should be effected immediately.

### Dilution of liquidation rewards to miners
* Scenario: The first person to call liquidate or dispute gets the reward, which results in a gas price war. 
In the limit, the gas price for a liquidation or dispute will be as high as the reward itself, effectively sending the reward to the miner (“miner extractable value”).
* Solution: This is a common problem for all DeFi “arbitrage” transactions. 
One alternative is to use an auction for liquidation to move from a gas bidding war to a price bidding war for the reward.

# Open Issues
Below is a list of known open issues regarding the capital efficiency of token sponsor, liquidator, and disputer positions related to this financial contract template. 
We’ve categorized and ranked the open issues by likelihood of impact. 

Note that the financial contract template has an emergency shutdown feature that prematurely expires the contract. 
This can only be triggered by a vote approved by UMA token holders. 
Emergency shutdown prematurely expires the contract and the final resolution depends on a DVM price, which could take 2-4 days to arrive.

## Open issues affecting incentives to liquidate:
### No haircut mechanisms implemented
* Scenario: If any token sponsor’s position is collateralized by < 100%, there is no incentive to liquidate them. 
If the contract expires with any sponsors below 100% collateral, there will be a race to pull collateral from the contract. 
Whichever sponsors and token holders redeem first will receive collateral. 
Whoever comes last will receive less or nothing depending on the amount of collateral left in the contract.
* Solution: Although we expect the economic incentives to work without a haircut mechanism, if a position does reach < 100% collateralization, UMA will liquidate these positions uneconomically.

## Open issues affecting capital efficiency: 
### New token creation
* Scenario: Token sponsors who wish to create new tokens are required to collateralize the new tokens at levels that meet or exceed the global collateralization ratio (GCR). 
However, this makes the role of token sponsor capital inefficient for 2 reasons: 
1. If a token sponsor has an outstanding synthetic token position collateralized well above the GCR, such that the creation of new tokens could be supported by the current amount of excess collateral in their position, they cannot use this collateral to create new synthetic tokens. 
1. If a token sponsor wishes to create new tokens collateralized to a level below the GCR, they must first collateralize their position above the GCR and go through a “slow” withdrawal to withdraw their excess collateral.

### Whale griefing attack
* Scenario: A griefing sponsor can add a proportionally large amount of collateral relative to the rest of the contract while creating a very small debt position. 
This drastically imbalances the contract GCR upwards. 
For example, a malicious sponsor can add 100x the current contract collateral while only creating a 1wei position in debt. 
This results in the contract GCR drastically increasing (~100x), making all later sponsors required to be massively over collateralized. 
At best, this slows down future token sponsorship (must repeatedly create and wait on withdraw), and at worst, this can lock all future sponsorship, constricting token supply. 
This could make it difficult or impossible for liquidators to liquidate positions and simultaneously drive up the token price.
One worrisome attack vector is if a sponsor were to use this to constrict token supply, and then issue a withdraw request to bring their collateralization ratio to 0%. 
If liquidators cannot get tokens to liquidate the sponsor’s position during the liveness period, the sponsor could walk away with a profit. 
There are a number of assumptions that have to be in place for this to work: 
1. Few or no tokens were minted before this sponsor increased the GCR
2. The sponsor is better capitalized than any liquidator
3. A liquidator does not have enough tokens or collateral to issue a partial liquidation large enough to wipe out the profitability of the sponsor. 
If the sponsor is 100x collateralized, a partial liquidation for 1/100ths of the sponsor’s tokens would essentially wipe out all of the profit.
Any larger liquidations, and they would lose money after the remaining withdrawal went through. 

## Open issues affecting accurate fee payments:
### Fees may be charged on collateral outside of “Profit From Corruption”
* Scenario: In the current implementation, collateral that isn’t part of PFC is still taxed, which technically isn’t correct. Once a liquidation is settled, any collateral that hasn’t been withdrawn is charged until withdrawn. Similarly, once the contract expires, all non-withdrawn sponsor and tokenholder collateral is charged until withdrawn. 
* Solution: It is up to token holders and liquidators to withdraw collateral they are owed in a timely manner. 

### Final fee for the DVM is determined at liquidation time, not dispute time
* Scenario: The final fee is queried at the time of liquidation, which is not when the price request is issued to the DVM. 
If the final fee were to change between the liquidation and dispute, the contract could technically pay a different final fee than requested by the DVM.
* Solution: The DVM rules should include some flexibility around exactly when fees are queried vs paid. 
The liveness period is generally quite short, so this flexibility doesn’t add much risk.

## Open issues affecting ability to withdraw collateral:
### Network congestion
* Scenario: UMA’s liquidation or dispute bots are down for longer the liveness periods for  liquidations and disputes. 
This causes token sponsors to potentially be improperly liquidated or for the system to become undercollateralized. 
* Solution: Robust monitoring of liquidator and dispute bots. Increase the liveness period parameter.

### Rounding errors can accumulate in the contract
* Scenario: All token balance calculations within UMA’s contracts rely on fixed point math using the `FixedPoint` library. 
Due to the limit in decimal precision of this library (and Solidity in general) numerical operations can result in rounding at the least significant digit. 
Rounding errors are not withdrawable by anyone, so they are effectively locked forever.
* Solution: These errors should remain small for now. 
Long term, the contract could be changed to allow anyone to withdraw the discrepancy at any time, as Uniswap v2 does.

### Contract has insufficient collateral needed to pay DVM for expiration
* Scenario: At expiration, the contract needs to pay a final fee to the DVM to determine the final amounts of collateral owed to each counterparty.
If the contract has insufficient funds to do so, the contract will not be able to expire. 
* Solution: Since this fee comes out of the sponsors’ collateral pro-rata, all counterparties should monitor the contract to ensure that there is sufficient collateral come expiration.

## Notes on rounding errors:

All token balance calculations within UMA’s contracts rely on fixed point math using the `FixedPoint` library. 
Due to the limit in decimal precision of this library (and Solidity in general) numerical operations can result in rounding at the least significant digit. 

At a high level there are three distinct classes of rounding errors:
1. A difference between the amount of collateral the contract transfers to an account and the contract's internal representation of an account’s balance.
2. A difference in proportion between the number of synthetic tokens burned and collateral returned in redemptions.
3. Compounding drift in the cumulative fee multiplier as a result of iterative calculations.

There are a few solutions implemented here: 
1. Rounding error (1) is addressed by enforcing that all methods that modify internal token balances transfer the exact amount of collateral that the internal counter is decremented by. 
2. Rounding errors (2) and (3) are not directly addressed as they do not place the contract under any risk of lockup as the rounding is in favour of the contract, not the user. 
Additionally, to ensure that contract lockup does not occur, even in the under capitalized case from rounding, the final token sponsor to redeem can is able to receive a reduced share of collateral if the contract does not have enough to make them fully whole. 
This protects the last sponsor to settle by ensuring they can always withdraw, even if at a slight loss.
