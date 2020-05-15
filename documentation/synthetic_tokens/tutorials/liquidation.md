# Liquidation and Dispute Bots

## Motivation

The prompt and accurate execution of liquidations and disputes is a core assumption to all priceless financial contracts compatible with the UMA DVM.
Liquidation and dispute bots, as described below and implemented [here](https://github.com/UMAprotocol/protocol/tree/master/liquidator) and [here](https://github.com/UMAprotocol/protocol/tree/master/disputer), are infrastructure tools that will help maintain the overall health of the UMA ecosystem.
They are currently compatible with the priceless synthetic token contract template, as described [here](../explainer.md) and implemented [here](https://github.com/UMAprotocol/protocol/tree/master/core/contracts/financial-templates).

The liquidation bot monitors all open positions within a given expiring multi-party contract and liquidates positions if their collateralization ratio, as inferred from off-chain information about th value of the price identifier, drops below a given threshold.

The dispute bot monitors all liquidations occurring within a given expiring multi-party contract and initiates disputes against liquidations it deems invalid, as inferred from off-chain information about the value of the price identifier.
A liquidation is invalid if a position was in fact overcollateralized at the time of liquidation.

## Implementation

The liquidation and dispute bots are separate entities.
Each has its own wallet and can be run independently.
Decoupling any dependencies that the bots could have on each other decreases the risk of one crashing taking the other down.
The tutorial below will show each bot running within a separate docker container on GCP.

## Technical Tutorial

The instructions for setting up a liquidator bot and a dispute bot are very similar.
No smart contracts need to be deployed for these bots.
Each runs within a separate docker container on GCP.
All they need is the address of the EMP as an input parameter and an unlocked wallet for the bots to use.

<!-- TODO: Chris to write technical tutorial. -->

## Future Improvements

In the future, the liquidation and dispute bots should be able to take as input the specific thresholds to inform the point at which liquidation/dispute should occur.
