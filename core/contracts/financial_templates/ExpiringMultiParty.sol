pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "./Liquidation.sol";
import "../FixedPoint.sol";

contract ExpiringMultiParty is Liquidation {
    using FixedPoint for FixedPoint.Unsigned;

    constructor(
        bool _isTest,
        uint _positionExpiry,
        address _collateralCurrency,
        address _syntheticCurrency,
        FixedPoint.Unsigned memory _disputeBondPct,
        FixedPoint.Unsigned memory _sponsorDisputeRewardPct,
        FixedPoint.Unsigned memory _disputerDisputeRewardPct,
        uint _liquidationLiveness
    ) public Liquidation(
        _isTest,
        _positionExpiry,
        _collateralCurrency,
        _syntheticCurrency,
        _disputeBondPct,
        _sponsorDisputeRewardPct,
        _disputerDisputeRewardPct,
        _liquidationLiveness
    ) {}
}
