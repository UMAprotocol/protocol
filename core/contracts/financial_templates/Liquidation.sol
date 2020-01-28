pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

// import "../OracleInteface.sol";
import "../FixedPoint.sol";
import "../Testable.sol";

// TODO:
// - Events
// - Connect with Position and Global Index
// - Fees

contract Liquidation is Testable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint;

    enum Status { PreDispute, PendingDispute, DisputeSucceeded, DisputeFailed }

    struct _Liquidation {
        /**
         * REQUIRED
         */
        Status state;
        // VARIABLES INFORMED BY POSITION.sol
        // Liquidation needs to be aware of the Position that is derived from, which should
        // include the following variables (HARD CODED FOR NOW via Construction). Liquidation
        // will be able to determine the values for these variables using the sponsor address as a key
        // Synthetic Tokens required to be burned by liquidator to initiate dispute
        FixedPoint.Unsigned tokensOutstanding;
        // Collateral locked by contract and released upon expiry or post-dispute
        FixedPoint.Unsigned lockedCollateral;
        // Amount of collateral being liquidated, which could be different from
        // lockedCollateral if there were pending withdrawals at the time of liquidation
        FixedPoint.Unsigned liquidatedCollateral;
        // VARIABLES SET UPON CREATION OF A NEW LIQUIDATION
        // When Liquidation ends and becomes 'Expired'
        uint expiry;
        // Person who created this liquidation
        address liquidator;
        /**
         * OPTIONAL
         */
        // Person who is disputing a liquidation
        address disputer;
        // Time when dispute is initiated, needed to get price from Oracle
        uint disputeTime;
        // Final price as determined by an Oracle following a dispute
        // TODO: Should this be FixedPoint?
        FixedPoint.Unsigned settlementPrice;
    }
    mapping(address => mapping(uint => _Liquidation)) public liquidations;

    // VARIABLES INFORMED BY GLOBAL contract
    // All Liquidations (and Positions) are constrained by these global variables
    // set at index creation time (HARD CODED FOR NOW via Construction).
    //
    //
    // Type of synthetic token
    IERC20 syntheticCurrency;
    // Type of token used for collateral
    IERC20 collateralCurrency;
    // Amount of time for pending liquidation before expiry
    uint liquidationLiveness;
    // Oracle supported identifier
    // TODO: bytes32 identifier;
    // Oracle that settles disputes and returns a price
    // TODO: OracleInteface oracle;
    // Percent of a Liquidation/Position's lockedCollateral to be deposited by a potential disputer
    // Represented as a multiplier, for example 1.5e18 = "150%" and 0.05e18 = "5%"
    FixedPoint.Unsigned disputeBondPct;
    // Percent of oraclePrice paid to sponsor in the Disputed state (i.e. following a successful dispute)
    // Represented as a multipler, see above
    FixedPoint.Unsigned sponsorDisputeRewardPct;
    // Percent of oraclePrice paid to disputer in the Disputed state (i.e. following a successful dispute)
    // Represented as a multipler, see above
    FixedPoint.Unsigned disputerDisputeRewardPct;

    modifier onlyPreExpiryAndPreDispute(uint id, address sponsor) {
        require(
            (getCurrentTime() < getLiquidation(sponsor, id).expiry) &&
                (getLiquidation(sponsor, id).state == Status.PreDispute),
            "Liquidation has expired or has already been disputed"
        );
        _;
    }
    modifier onlyPostExpiryOrPostDispute(uint id, address sponsor) {
        require(
            (getLiquidation(sponsor, id).state == Status.DisputeSucceeded) ||
                (getLiquidation(sponsor, id).state == Status.DisputeFailed) ||
                ((getLiquidation(sponsor, id).expiry <= getCurrentTime()) &&
                    (getLiquidation(sponsor, id).state == Status.PreDispute)),
            "Liquidation has not expired or is pending dispute"
        );
        _;
    }
    modifier onlyPendingDispute(uint id, address sponsor) {
        require(
            getLiquidation(sponsor, id).state == Status.PendingDispute,
            "Liquidation is not currently pending dispute"
        );
        _;
    }

    // FOR TESTING PURPOSES MAINLY
    // Hard codes a bunch of variables that should be determined programmatically in production
    // The implication right now is that Liquidation inherits ExpiringMultiParty as a base class
    constructor(
        bool _isTest,
        address _collateralCurrency,
        address _syntheticCurrency,
        FixedPoint.Unsigned memory _disputeBondPct,
        FixedPoint.Unsigned memory _sponsorDisputeRewardPct,
        FixedPoint.Unsigned memory _disputerDisputeRewardPct,
        uint _liquidationLiveness
    ) public Testable(_isTest) {
        collateralCurrency = IERC20(_collateralCurrency);
        syntheticCurrency = IERC20(_syntheticCurrency);
        disputeBondPct = _disputeBondPct;
        sponsorDisputeRewardPct = _sponsorDisputeRewardPct;
        disputerDisputeRewardPct = _disputerDisputeRewardPct;
        liquidationLiveness = _liquidationLiveness;
    }

    // Creates a new liquidation for sponsor with caller as liquidator and returns the UUID
    // ACCESS: Caller must have enough TRV to retire outstanding tokens
    // FOR TESTING PURPOSES: I make the following simplifications
    // - Allow caller to pass in uuid
    // - Allow caller to pass all position variables
    function createLiquidation(
        address sponsor,
        uint uuid,
        FixedPoint.Unsigned memory _tokensOutstanding,
        FixedPoint.Unsigned memory _lockedCollateral,
        FixedPoint.Unsigned memory _liquidatedCollateral
    ) public returns (address, uint) {
        _Liquidation storage newLiquidation = liquidations[sponsor][uuid];
        // FOR TESTING: Hard code sponsor's position details
        // The implication right now is that we could populate these fields only knowing the sponsor's address
        newLiquidation.tokensOutstanding = _tokensOutstanding;
        newLiquidation.lockedCollateral = _lockedCollateral;
        newLiquidation.liquidatedCollateral = _liquidatedCollateral;

        // Set these after creation of new liquidation
        newLiquidation.expiry = getCurrentTime() + liquidationLiveness;
        newLiquidation.liquidator = msg.sender;
        newLiquidation.state = Status.PreDispute;

        require(
            syntheticCurrency.transferFrom(msg.sender, address(this), newLiquidation.tokensOutstanding.rawValue),
            "failed to transfer synthetic tokens from sender"
        );
    }

    function getLiquidation(address sponsor, uint uuid) private view returns (_Liquidation storage liquidation) {
        liquidation = liquidations[sponsor][uuid];
        require(liquidation.liquidator != address(0), "liquidator address is not set on this Liquidation");

    }

    // PRE-DISPUTE and PRE-EXPIRY: Can dispute, sends it to PENDING-DISPUTE
    // ACCESS: Only someone with enough Dispute-Bond can call and become the disputer
    function dispute(uint id, address sponsor) public onlyPreExpiryAndPreDispute(id, sponsor) {
        _Liquidation storage disputedLiquidation = getLiquidation(sponsor, id);

        FixedPoint.Unsigned memory disputeBondAmount = disputedLiquidation.lockedCollateral.mul(disputeBondPct);
        require(
            collateralCurrency.transferFrom(msg.sender, address(this), disputeBondAmount.rawValue),
            "failed to transfer dispute bond from sender"
        );

        // Request a price from DVM,
        // Liquidation is pending dispute until DVM returns a price
        disputedLiquidation.state = Status.PendingDispute;
        disputedLiquidation.disputer = msg.sender;
        disputedLiquidation.disputeTime = getCurrentTime();

        // TODO: Remove call to Oracle for testing purposes
        // require(disputedLiquidation.oracle.requestPrice(disputedLiquidation.identifier, disputedLiquidation.disputeTime), "oracle request failed");

    }

    // PENDING-DISPUTE: Sends it to DISPUTE_SUCCESS or DISPUTE_FAIL
    // ACCESS: Anyone can settle a dispute
    // FOR TESTING PURPOSES: I make the following simplifications
    // - Allow caller to pass in settlement price
    // - Allow caller to determine if liquidation failed or not
    function settleDispute(uint id, address sponsor, FixedPoint.Unsigned memory hardcodedPrice, bool disputeSucceeded)
        public
        onlyPendingDispute(id, sponsor)
    {
        _Liquidation storage disputedLiquidation = getLiquidation(sponsor, id);

        // if (disputedLiquidation.oracle.hasPrice(disputedLiquidation.identifier, disputedLiquidation.disputeTime)) {
        // If dispute is over set oracle price
        // disputedLiquidation.oraclePrice = disputedLiquidation.oracle.getPrice(
        //     disputedLiquidation.identifier,
        //     disputedLiquidation.disputeTime
        // );

        // TODO: For testing purposes
        disputedLiquidation.settlementPrice = hardcodedPrice;

        // TODO: Settle dispute using settlementPrice and liquidatedTokens (which might be different from lockedCollateral!)
        if (disputeSucceeded) {
            // If dispute is successful
            disputedLiquidation.state = Status.DisputeSucceeded;
        } else {
            // If dispute fails
            disputedLiquidation.state = Status.DisputeFailed;
        }

        // } else {
        //     return;
        // }

    }

    // DISPUTE_FAILED, DISPUTE_SUCCEEDED or postExpiry
    // ACCESS: Only sponsor and disputer if successful dispute, only liquidator if unsuccessful dispute
    function withdrawLiquidation(uint id, address sponsor) public onlyPostExpiryOrPostDispute(id, sponsor) {
        _Liquidation storage liquidation = getLiquidation(sponsor, id);
        require(
            (msg.sender == liquidation.disputer) || (msg.sender == liquidation.liquidator) || (msg.sender == sponsor),
            "must be a disputer, liquidator, or sponsor to request a withdrawal on a liquidation"
        );

        FixedPoint.Unsigned memory tokenRedemptionValue = liquidation.tokensOutstanding.mul(
            liquidation.settlementPrice
        );
        FixedPoint.Unsigned memory disputerDisputeReward = disputerDisputeRewardPct.mul(tokenRedemptionValue);
        FixedPoint.Unsigned memory disputeBondAmount = liquidation.lockedCollateral.mul(disputeBondPct);
        FixedPoint.Unsigned memory sponsorDisputeReward = sponsorDisputeRewardPct.mul(tokenRedemptionValue);

        // SUCCESSFUL DISPUTE
        if (liquidation.state == Status.DisputeSucceeded) {
            if (msg.sender == liquidation.disputer) {
                // Pay: disputer reward + dispute bond
                FixedPoint.Unsigned memory payToDisputer = disputerDisputeReward.add(disputeBondAmount);
                require(
                    collateralCurrency.transfer(msg.sender, payToDisputer.rawValue),
                    "failed to transfer reward for a successful dispute to disputer"
                );
            } else if (msg.sender == sponsor) {
                // Pay: remaining collateral (locked collateral - TRV) + sponsor reward
                FixedPoint.Unsigned memory remainingCollateral = liquidation.lockedCollateral.sub(tokenRedemptionValue);
                FixedPoint.Unsigned memory payToSponsor = sponsorDisputeReward.add(remainingCollateral);
                require(
                    collateralCurrency.transfer(msg.sender, payToSponsor.rawValue),
                    "failed to transfer reward for a successful dispute to sponsor"
                );
            } else if (msg.sender == liquidation.liquidator) {
                // Pay: TRV - dispute reward - sponsor reward
                FixedPoint.Unsigned memory payToLiquidator = tokenRedemptionValue.sub(
                    sponsorDisputeReward.sub(disputerDisputeReward)
                );
                require(
                    collateralCurrency.transfer(msg.sender, payToLiquidator.rawValue),
                    "failed to transfer reward for a successful dispute to liquidator"
                );
            }
        } else if (liquidation.state == Status.DisputeFailed) {
            // Pay all lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral to liquidator
            if (msg.sender == liquidation.liquidator) {
                FixedPoint.Unsigned memory payToLiquidator = liquidation.lockedCollateral.add(disputeBondAmount);
                require(
                    collateralCurrency.transfer(msg.sender, payToLiquidator.rawValue),
                    "failed to transfer locked collateral plus dispute bond to liquidator"
                );
            } else {
                require(false, "only the liquidator can call withdrawal on an unsuccessfully disputed liquidation");
            }
        } else if (liquidation.state == Status.PreDispute) {
            // Must have expired without liquidation
            // Pay all lockedCollateral to liquidator
            if (msg.sender == liquidation.liquidator) {
                require(
                    collateralCurrency.transfer(msg.sender, liquidation.lockedCollateral.rawValue),
                    "failed to transfer locked collateral to liquidator"
                );
            } else {
                require(false, "only the liquidator can call withdrawal on a non-disputed, expired liquidation");
            }
        } else {
            // Liquidation is in the middle of a dispute, should not get here
            require(false, "Cannot withdraw during a pending dispute");
        }
    }
}
