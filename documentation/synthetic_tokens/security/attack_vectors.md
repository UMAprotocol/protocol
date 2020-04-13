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
