// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/FixedPoint.sol";

/**
 * @title Simple Perpetual Mock to serve trivial functions
 */
contract PerpetualMock {
    struct FundingRate {
        FixedPoint.Signed rate;
        bytes32 identifier;
        FixedPoint.Unsigned cumulativeMultiplier;
        uint256 updateTime;
        uint256 applicationTime;
        uint256 proposalTime;
    }

    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;

    FundingRate public fundingRate;

    // Interface functions required to be implemented in order for an instance of this contract to be passed into the
    // off-chain FinancialContractClient helper module:
    FixedPoint.Unsigned public collateralRequirement;
    uint256 public liquidationLiveness;
    FixedPoint.Unsigned public cumulativeFeeMultiplier;
    mapping(address => uint256) public positions;
    mapping(address => uint256) public liquidations;
    event NewSponsor(address indexed sponsor);
    event EndedSponsorPosition();
    event LiquidationCreated();

    function getCurrentTime() public view returns (uint256) {
        return block.timestamp;
    }

    // Public methods that are useful for tests:
    function setFundingRate(FundingRate memory _fundingRate) external {
        fundingRate = _fundingRate;
    }

    function applyFundingRate() external {
        fundingRate.applicationTime = block.timestamp;
        // Simplified rate calcualtion.
        // multiplier = multiplier * (1 + rate)
        fundingRate.cumulativeMultiplier = fundingRate.cumulativeMultiplier.mul(
            FixedPoint.fromSigned(FixedPoint.fromUnscaledInt(1).add(fundingRate.rate))
        );
    }
}
