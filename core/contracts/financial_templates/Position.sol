pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../ExpandedIERC20.sol";
import "../FixedPoint.sol";
import "../Testable.sol";
import "./Token.sol";

contract Position is Testable {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;

    struct PositionData {
        address sponsor;
        FixedPoint.Unsigned collateral;
        FixedPoint.Unsigned tokensOutstanding;
        // Withdrawal request stuff.
        FixedPoint.Unsigned withdrawalRequestAmount;
        uint requestPassTimestamp;
    }
    mapping(address => PositionData) public positions;

    FixedPoint.Unsigned public totalPositionCollateral;
    FixedPoint.Unsigned public totalTokensOutstanding;

    ExpandedIERC20 public token;
    IERC20 public collateral;

    uint expirationTimestamp;
    uint withdrawalLiveness;

    constructor(uint _expirationTimestamp, address collateralAddress, bool _isTest) public Testable(_isTest) {
        expirationTimestamp = _expirationTimestamp;
        // TODO: This should be settable.
        withdrawalLiveness = 1000;
        collateral = IERC20(collateralAddress);
        Token mintableToken = new Token();
        token = ExpandedIERC20(address(mintableToken));
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
        require(positionData.requestPassTimestamp == 0);
        positionData.collateral = positionData.collateral.add(collateralAmount);
        totalPositionCollateral = totalPositionCollateral.add(collateralAmount);
        require(collateral.transferFrom(msg.sender, address(this), collateralAmount.rawValue));
    }

    function withdraw(FixedPoint.Unsigned memory collateralAmount) public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData();
        require(positionData.requestPassTimestamp == 0);

        positionData.collateral = positionData.collateral.sub(collateralAmount);
        require(_checkCollateralizationRatio(positionData));
        totalPositionCollateral = totalPositionCollateral.sub(collateralAmount);
        require(collateral.transfer(msg.sender, collateralAmount.rawValue));
    }

    // Decide whether to fold this functionality into withdraw() method above.
    function withdrawPassedRequest() public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData();
        require(positionData.requestPassTimestamp < getCurrentTime());

        positionData.collateral = positionData.collateral.sub(positionData.withdrawalRequestAmount);
        totalPositionCollateral = totalPositionCollateral.sub(positionData.withdrawalRequestAmount);

        positionData.requestPassTimestamp = 0;
        require(collateral.transfer(msg.sender, positionData.withdrawalRequestAmount.rawValue));
    }

    function requestWithdrawal(FixedPoint.Unsigned memory collateralAmount) public {
        PositionData storage positionData = _getPositionData();
        require(positionData.requestPassTimestamp == 0);

        // Not just pre-expiration: make sure the proposed expiration of this request is itself before expiry.
        uint requestPassTime = getCurrentTime() + withdrawalLiveness;
        require(requestPassTime < expirationTimestamp);

        // TODO: Handle case around downsizing a withdrawal request without resetting requestPassTime.
        positionData.requestPassTimestamp = requestPassTime;
        positionData.withdrawalRequestAmount = collateralAmount;
    }

    function cancelWithdrawal() public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData();
        require(positionData.requestPassTimestamp != 0);
        positionData.requestPassTimestamp = 0;
    }

    function create(FixedPoint.Unsigned memory collateralAmount, FixedPoint.Unsigned memory numTokens)
        public
        onlyPreExpiration()
    {
        PositionData storage positionData = positions[msg.sender];
        require(positionData.requestPassTimestamp == 0);
        if (positionData.sponsor == address(0)) {
            positionData.sponsor = msg.sender;
        }
        positionData.collateral = positionData.collateral.add(collateralAmount);
        positionData.tokensOutstanding = positionData.tokensOutstanding.add(numTokens);
        require(_checkCollateralizationRatio(positionData));

        totalPositionCollateral = totalPositionCollateral.add(collateralAmount);
        totalTokensOutstanding = totalTokensOutstanding.add(numTokens);
        require(collateral.transferFrom(msg.sender, address(this), collateralAmount.rawValue));
        require(token.mint(msg.sender, numTokens.rawValue));
    }

    function redeem(FixedPoint.Unsigned memory numTokens) public onlyPreExpiration() {
        PositionData storage positionData = _getPositionData();
        require(positionData.requestPassTimestamp == 0);
        require(!numTokens.isGreaterThan(positionData.tokensOutstanding));

        FixedPoint.Unsigned memory fractionRedeemed = numTokens.div(positionData.tokensOutstanding);
        FixedPoint.Unsigned memory collateralRedeemed = fractionRedeemed.mul(positionData.collateral);

        positionData.collateral = positionData.collateral.sub(collateralRedeemed);
        totalPositionCollateral = totalPositionCollateral.sub(collateralRedeemed);
        // TODO: Need to wipe out the struct entirely on full redemption.
        positionData.tokensOutstanding = positionData.tokensOutstanding.sub(numTokens);
        totalTokensOutstanding = totalTokensOutstanding.sub(numTokens);

        require(collateral.transfer(msg.sender, collateralRedeemed.rawValue));
        // TODO: Use `burnFrom` here?
        require(token.transferFrom(msg.sender, address(this), numTokens.rawValue));
        token.burn(numTokens.rawValue);
    }

    function _getPositionData() private view returns (PositionData storage positionData) {
        positionData = positions[msg.sender];
        require(positionData.sponsor != address(0));
    }

    function _checkCollateralizationRatio(PositionData storage positionData) private returns (bool) {
        FixedPoint.Unsigned memory global = _getCollateralizationRatio(totalPositionCollateral, totalTokensOutstanding);
        FixedPoint.Unsigned memory thisPos = _getCollateralizationRatio(
            positionData.collateral,
            positionData.tokensOutstanding
        );
        return !global.isGreaterThan(thisPos);
    }

    function _getCollateralizationRatio(FixedPoint.Unsigned storage collateral, FixedPoint.Unsigned storage numTokens)
        private
        view
        returns (FixedPoint.Unsigned memory ratio)
    {
        if (!numTokens.isGreaterThan(0)) {
            return FixedPoint.fromUnscaledUint(0);
        } else {
            return collateral.div(numTokens);
        }
    }
}
