pragma solidity ^0.5.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../OracleInteface.sol";

contract Liquidation {
    using SafeMath for uint;

    enum Status { PreDispute, PendingDispute, DisputeSucceeded, DisputeFailed }

    struct _Liquidation {
        /**
         * REQUIRED
         */
        Status state;
        // Uniquely identifies this Liquidation, which is uniquely combined with the sponsor's address
        uint uuid;
        // When Liquidation was created
        uint timestamp;
        // When Liquidation ends and becomes 'Expired'
        uint expiry;
        // Oracle supported identifier
        bytes32 identifier;
        // Oracle that settles disputes and returns a price
        OracleInteface oracle;
        // Sponsor whose position was originally liquidated
        address sponsor;
        // Person who created this liquidation
        address liquidator;
        // Tokens burned by liquidator to initiate dispute
        uint liquidatedTokens;
        // Type of token used for collateral
        IERC20 collateralCurrency;
        // Collateral locked by contract and released upon expiry or post-dispute
        uint lockedCollateral;
        // Amount of collateral being liquidated, which could be different from
        // lockedCollateral if there were pending withdrawals at the time of liquidation
        uint liquidatedCollateral;
        // Percent of lockedCollateral to be deposited by a potential disputer
        uint disputeBond;
        // Percent of oraclePrice paid to sponsor in the Disputed state (i.e. following a successful dispute)
        uint sponsorDisputeReward;
        // Percent of oraclePrice paid to disputer in the Disputed state (i.e. following a successful dispute)
        uint disputerDisputeReward;

        /**
         * OPTIONAL
         */
        // Person who is disputing a liquidation
        address disputer;
        uint disputeTime;
        // Final price as determined by an Oracle following a dispute
        uint oraclePrice;
        // Amount of collateral token equal to (liquidatedTokens * oraclePrice),
        // calculated post-dispute once we know the oracle price
        uint tokenRedemptionValue;
    }

    mapping(address => mapping (uint => _Liquidation)) private liquidations;

    modifier onlyPreExpiry(uint id, address sponsor) {
        require(liquidations[sponsor][id].timestamp + liquidations[sponsor][id].expiry < now, "Liquidation has expired");
        _;
    }
    modifier onlyPostExpiry(uint id, address sponsor) {
        require(liquidations[sponsor][id].timestamp + liquidations[sponsor][id].expiry >= now, "Liquidation has not expired");
        _;
    }
    modifier onlyWithWithdrawRights(uint id, address sponsor) {
        if (liquidations[sponsor][id].state == Status.DisputeSucceeded) {
            require(
                (
                    msg.sender == liquidations[sponsor][id].sponsor ||
                    msg.sender == liquidations[sponsor][id].disputer
                ), "Only Sponsor and Disputer can withdraw after a successful dispute"
            );
        } else if (liquidations[sponsor].state == Status.DisputeFailed) {
            require(msg.sender == liquidations[sponsor][id].liquidator, "Only Liquidator can withdraw after an expired liquidation or a failed dispute");
        } else {
            require(false, "No withdrawals allowed during live liquidations");
        }
        _;
    }
    modifier onlyPreDispute(uint id, address sponsor) {
        require(liquidations[sponsor][id].state == Status.PreDispute, "Liquidation is either pending dispute or post-dispute");
        _;
    }
    modifier onlyPendingDispute(uint id, address sponsor) {
        require(liquidations[sponsor][id].state == Status.PendingDispute, "Liquidation is not currently pending dispute");
        _;
    }

    // PRE-DISPUTE and PRE-EXPIRY: Can dispute, sends it to PENDING-DISPUTE
    function dispute(uint id, address sponsor, address liquidator) external onlyPreDispute(id, sponsor) onlyPreExpiry(id, sponsor) {
        _Liquidation disputedLiquidation = liquidations[sponsor][id];
        IERC20 liquidationCollateral = disputedLiquidation.collateralCurrency;
        
        require(
            liquidationCollateral.balanceOf(msg.sender) >= disputedLiquidation.disputeBond, 
            "disputer does not have enough collateral to pay dispute bond"
        );

        // Liquidation is pending dispute until DVM returns a price
        disputedLiquidation.state = Status.PendingDispute;
        disputedLiquidation.disputer = msg.sender;

        // Request a price
        uint disputeTime = now;
        disputedLiquidation.disputeTime = disputeTime;
        require(disputedLiquidation.oracle.requestPrice(disputedLiquidation.identifier, disputeTime), "oracle request failed");
    } 

    // PENDING-DISPUTE: Sends it to DISPUTE_SUCCESS or DISPUTE_FAIL
    function settleDispute(uint id, address sponsor) external onlyPendingDispute(id, sponsor) {
        _Liquidation disputedLiquidation = liquidations[sponsor][id];

        if (disputedLiquidation.oracle.hasPrice(disputedLiquidation.identifier, disputedLiquidation.disputeTime)) {
            // If dispute is over set oracle price and TRV
            disputedLiquidation.tokenRedemptionValue = disputedLiquidation.liquidatedTokens.mul(disputedLiquidation.oraclePrice);
            disputedLiquidation.oraclePrice = disputedLiquidation.oracle.getPrice(disputedLiquidation.identifier, disputedLiquidation.disputeTime);

            // If dispute is successful
            disputedLiquidation.state = State.DisputeSucceeded;

            // If dispute fails
            disputedLiquidation.state = State.DisputeFailed;
        } else {
            return;
        }
    }

    // DISPUTE_FAILED, DISPUTE_SUCCEEDED or postExpiry
    function withdraw(uint id, address sponsor) external onlyPostExpiry(id, sponsor) onlyWithWithdrawRights(id, sponsor) {
        _Liquidation liquidation = liquidations[sponsor][id];
        IERC20 liquidationCollateral = liquidation.collateralCurrency;

        if (liquidation.state == Status.DisputeSucceeded) {
            // DISPUTER
            // Pay: liquidation.disputerDisputeReward % of liquidation.tokenRedemptionValue
            // + liquidation.disputeBond % of liquidation.lockedCollateral to disputer

            // SPONSOR
            // Pay: liquidation.lockedCollateral
            // - (liquidation.tokenRedemptionValue
            //    - (liquidation.disputerDisputeReward % of liquidation.tokenRedemptionValue)
            //    + (liquidation.sponsorDisputeReward % of liquidation.tokenRedemptionValue)
            //   )
            // - liquidation.disputeBond % of liquidation.lockedCollateral to disputer
            // to sponsor

            // Pay: liquidation.tokenRedemptionValue
            // - (liquidation.disputerDisputeReward % of liquidation.tokenRedemptionValue)
            // - (liquidation.sponsorDisputeReward % of liquidation.tokenRedemptionValue) to liquidator
        } else if (liquidation.state == Status.DisputeFailed) {
            // Pay all lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral to liquidator
        } else if (liquidation.state == Status.PreDispute) {
            // Must have expired without liquidation
            // Pay all lockedCollateral to liquidator
        } else {
            // Liquidation is in the middle of a dispute, should not get here
        }
    }
}
