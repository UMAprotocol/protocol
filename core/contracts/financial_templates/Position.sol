pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "../FixedPoint.sol";
import "../Testable.sol";

contract Position is Testable {
    using FixedPoint for FixedPoint.Unsigned;

    struct PositionData {
        address sponsor;
        FixedPoint.Unsigned collateral;
        FixedPoint.Unsigned tokensOutstanding;
    }
    mapping(address => PositionData) public positions;

    // TODO: Not the final place for these fields.
    address collateralAddress;

    FixedPoint.Unsigned public totalPositionCollateral;
    FixedPoint.Unsigned public totalTokensOutstanding;

    uint expirationTimestamp;

    constructor(uint _expirationTimestamp, bool _isTest) public Testable(_isTest) {
        expirationTimestamp = _expirationTimestamp;
    }

    modifier onlyPreExpiration() {
        // TODO: Do we need a window around expiration?
        require(getCurrentTime() < expirationTimestamp);
        _;
    }

    function transfer(address newSponsorAddress) public onlyPreExpiration() {
        require(positions[newSponsorAddress].sponsor == address(0));
        PositionData storage positionData = _getPositionData();
        positionData.sponsor = newSponsorAddress;
        positions[newSponsorAddress] = positionData;
    }

    function deposit(FixedPoint.Unsigned memory collateralAmount) public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData();
        positionData.collateral = positionData.collateral.add(collateralAmount);
        totalPositionCollateral = totalPositionCollateral.add(collateralAmount);
    }

    function withdraw(FixedPoint.Unsigned memory collateralAmount) public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData();

        positionData.collateral = positionData.collateral.sub(collateralAmount);
        totalPositionCollateral = totalPositionCollateral.sub(collateralAmount);
    }

    function create(FixedPoint.Unsigned memory collateralAmount, FixedPoint.Unsigned memory numTokens)
        public
        onlyPreExpiration()
    {
        PositionData storage positionData = positions[msg.sender];
        if (positionData.sponsor == address(0)) {
            positionData.sponsor = msg.sender;
        }
        positionData.collateral = positionData.collateral.add(collateralAmount);
        totalPositionCollateral = totalPositionCollateral.add(collateralAmount);
        positionData.tokensOutstanding = positionData.tokensOutstanding.add(numTokens);
        totalTokensOutstanding = totalTokensOutstanding.add(numTokens);
    }

    function redeem(FixedPoint.Unsigned memory numTokens) public {
        PositionData storage positionData = _getPositionData();
        require(!numTokens.isGreaterThan(positionData.tokensOutstanding));

        FixedPoint.Unsigned memory fractionRedeemed = numTokens.div(positionData.tokensOutstanding);
        FixedPoint.Unsigned memory collateralRedeemed = fractionRedeemed.mul(positionData.collateral);

        positionData.collateral = positionData.collateral.sub(collateralRedeemed);
        totalPositionCollateral = totalPositionCollateral.sub(collateralRedeemed);
        // TODO: Need to wipe out the struct entirely on full redemption.
        positionData.tokensOutstanding = positionData.tokensOutstanding.sub(numTokens);
        totalTokensOutstanding = totalTokensOutstanding.sub(numTokens);
    }

    function _getPositionData() private view returns (PositionData storage positionData) {
        positionData = positions[msg.sender];
        require(positionData.sponsor != address(0));
    }
}
