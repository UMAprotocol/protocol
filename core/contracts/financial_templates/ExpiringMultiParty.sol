pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "./Liquidatable.sol";
import "../FixedPoint.sol";

contract ExpiringMultiParty is Liquidatable {
    using FixedPoint for FixedPoint.Unsigned;

    constructor(
        bool _isTest,
        uint _positionExpiry,
        uint _positionWithdrawalLiveness,
        address _collateralCurrency,
        FixedPoint.Unsigned memory _disputeBondPct,
        FixedPoint.Unsigned memory _sponsorDisputeRewardPct,
        FixedPoint.Unsigned memory _disputerDisputeRewardPct,
        uint _liquidationLiveness
    )
        public
        Liquidatable(
            _isTest,
            _positionExpiry,
            _positionWithdrawalLiveness,
            _collateralCurrency,
            _disputeBondPct,
            _sponsorDisputeRewardPct,
            _disputerDisputeRewardPct,
            _liquidationLiveness
        )
    {}
}
