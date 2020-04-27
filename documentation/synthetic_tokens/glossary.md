# Glossary
### DVM
The “Data Verification Mechanism” (DVM) is the name of the oracle service provided by UMA. The DVM does not provide an on-chain price feed. 
Instead, it is only used to resolve disputes of liquidations and to settle synthetic token contracts upon expiration. 

### Token sponsor
A token sponsor is an entity who bears the financial risk of the synthetic tokens. 
This entity deposits collateral into the smart contract and withdraws synthetic tokens that they can then sell to token holders. 
Token sponsors have short exposure to the price identifiers of the synthetic tokens they sponsor. 

## Parameters of a synthetic token smart contract:
### Price identifier
This is a natural language descriptor of the reference index determining how much collateral is needed for a token sponsor to be properly collateralized. 
Because DVM voters need to be able to vote on the value of this price identifier when disputes are raised, the DVM keeps a list of approved price identifiers. 
* Example: “Gold_June2020_24hTWAP”

### Token redemption value
This is a function which, when evaluated only in the event of a dispute, returns the amount of collateral to be returned to a token holder, not including any penalties or fees. 
* Example: 24-hour TWAP price of gold June 2020 synthetic token trades on Uniswap. 

### Token settlement value
This is a function which, when evaluated at or after the expiration timestamp of a synthetic token, returns the amount of collateral that will be returned to a token holder who redeems a synthetic token. 
* Example: Price of 1 oz of gold on June 2020 at 5pm ET. 

### Collateralization requirement
Each token sponsor must, at all times, maintain collateral such that the ratio of deposited collateral to token settlement value, per synthetic token outstanding, is greater than the collateralization requirement. 
* Example: If the collateralization requirement is 125%, a token sponsor must always have deposited collateral in excess of 125% * # synthetic tokens outstanding * token redemption value. 

### Withdrawal liveness period
In a “slow” withdrawal, a token sponsor must make a withdrawal request and wait for the withdrawal liveness period to elapse without a liquidation before they can withdraw collateral up to the amount requested. 
* Example: 1 hour.

### Liquidation liveness period
Once a token sponsor position has been liquidated, collateral is not transferred between the liquidator and the token sponsor until a liquidation liveness period has elapsed without a dispute of the liquidation. 
If a disputer disputes the liquidation, all collateral is frozen until the UMA DVM returns the token redemption value and collateral can be distributed to each participant.
* Example: 1 hour.
    
## Calculated values of a synthetic token smart contract:
### Global collateralization ratio (GCR)
This is the average collateralization ratio across all token sponsors of a synthetic token, excluding those that have been liquidated. 
It is calculated by dividing the total collateral deposited by all token sponsors in the contract by the total number of outstanding synthetic tokens.  
The GCR is used to set collateralization requirements for new synthetic token issuance and to enable “fast” withdrawals. 
