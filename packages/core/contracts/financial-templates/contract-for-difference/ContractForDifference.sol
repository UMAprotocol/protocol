// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../common/financial-product-libraries/ContractForDifferenceFinancialProductLibrary.sol";

import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/interfaces/ExpandedIERC20.sol";
import "../../common/interfaces/IERC20Standard.sol";

import "../../oracle/interfaces/OracleInterface.sol";

import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/interfaces/OptimisticOracleInterface.sol";
import "../../oracle/interfaces/IdentifierWhitelistInterface.sol";

import "../../oracle/implementation/Constants.sol";

contract ContractForDifference is Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ExpandedIERC20;

    enum ContractState { Open, ExpiredPriceRequested, ExpiredPriceReceived }
    ContractState public contractState;

    uint32 public expirationTimestamp;

    uint256 public collateralPerPair;
    uint256 public totalCollateral;
    uint256 public expiryPrice;
    uint256 public expirationTokensForCollateral;

    bytes32 public priceIdentifier;

    IERC20 public collateralToken;
    ExpandedIERC20 public longToken;
    ExpandedIERC20 public shortToken;

    FinderInterface public finder;

    ContractForDifferenceFinancialProductLibrary public financialProductLibrary;

    modifier preExpiration() {
        require(getCurrentTime() < expirationTimestamp, "Only callable pre-expiry");
        _;
    }

    modifier postExpiration() {
        require(getCurrentTime() >= expirationTimestamp, "Only callable post-expiry");
        _;
    }

    modifier onlyOpenState() {
        require(contractState == ContractState.Open, "Contract state is not Open");
        _;
    }

    constructor(
        uint32 _expirationTimestamp,
        uint256 _collateralPerPair,
        address _longTokenAddress,
        address _shortTokenAddress,
        address _finderAddress,
        bytes32 _priceIdentifier,
        address _collateralAddress,
        address _financialProductLibrary,
        address _timerAddress
    ) Testable(_timerAddress) {
        finder = FinderInterface(_finderAddress);
        require(_expirationTimestamp > getCurrentTime());
        require(_getIdentifierWhitelist().isIdentifierSupported(_priceIdentifier));
        require(_financialProductLibrary != address(0));

        expirationTimestamp = _expirationTimestamp;
        collateralPerPair = _collateralPerPair;
        longToken = ExpandedIERC20(_longTokenAddress);
        shortToken = ExpandedIERC20(_shortTokenAddress);
        collateralToken = IERC20(_collateralAddress);
        priceIdentifier = _priceIdentifier;

        financialProductLibrary = ContractForDifferenceFinancialProductLibrary(_financialProductLibrary);
    }

    function create(uint256 tokensToCreate) public preExpiration() returns (uint256 collateralUsed) {
        collateralUsed = FixedPoint.Unsigned(tokensToCreate).mul(FixedPoint.Unsigned(collateralPerPair)).rawValue;

        collateralToken.safeTransferFrom(msg.sender, address(this), collateralUsed);

        require(longToken.mint(msg.sender, tokensToCreate));
        require(shortToken.mint(msg.sender, tokensToCreate));
    }

    function redeem(uint256 tokensToRedeem) public preExpiration() nonReentrant() returns (uint256 collateralReturned) {
        require(longToken.burnFrom(msg.sender, tokensToRedeem));
        require(shortToken.burnFrom(msg.sender, tokensToRedeem));

        collateralReturned = FixedPoint.Unsigned(tokensToRedeem).mul(FixedPoint.Unsigned(collateralPerPair)).rawValue;

        collateralToken.safeTransfer(msg.sender, collateralReturned);
    }

    function expire() public postExpiration() onlyOpenState() nonReentrant() {
        _requestOraclePriceExpiration();
        contractState = ContractState.ExpiredPriceRequested;
    }

    function settle(uint256 longTokensToRedeem, uint256 shortTokensToRedeem)
        public
        postExpiration()
        nonReentrant()
        returns (uint256 collateralReturned)
    {
        // If the contract state is open and postExpiration passed then `expire()` has not yet been called.
        require(contractState != ContractState.Open, "Unexpired contract");

        // Get the current settlement price and store it. If it is not resolved will revert.
        if (contractState != ContractState.ExpiredPriceReceived) {
            expiryPrice = _getOraclePriceExpiration(expirationTimestamp);
            expirationTokensForCollateral = financialProductLibrary.expirationTokensForCollateral(expiryPrice);
            contractState = ContractState.ExpiredPriceReceived;
        }

        require(longToken.burnFrom(msg.sender, longTokensToRedeem));
        require(shortToken.burnFrom(msg.sender, shortTokensToRedeem));

        // ExpirationTokensForCollateral is a number between 0 and 1e18. 0 means all collateral goes to short tokens and
        // 1 means all collateral goes to the long token. Total collateral returned is the sum of payouts.
        // uint256 collateralPerToken = collateralPerPair;

        uint256 longCollateralRedeemed =
            FixedPoint
                .Unsigned(longTokensToRedeem)
                .mul(FixedPoint.Unsigned(collateralPerPair))
                .mul(FixedPoint.Unsigned(expirationTokensForCollateral))
                .rawValue;
        uint256 shortCollateralRedeemed =
            FixedPoint
                .Unsigned(shortTokensToRedeem)
                .mul(FixedPoint.Unsigned(collateralPerPair))
                .mul(FixedPoint.fromUnscaledUint(1).sub(FixedPoint.Unsigned(expirationTokensForCollateral)))
                .rawValue;

        collateralReturned = longCollateralRedeemed.add(shortCollateralRedeemed);
        collateralToken.safeTransfer(msg.sender, collateralReturned);
    }

    function _getOraclePriceExpiration(uint256 requestedTime) internal returns (uint256) {
        // Create an instance of the oracle and get the price. If the price is not resolved revert.
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        require(optimisticOracle.hasPrice(address(this), priceIdentifier, requestedTime, _getAncillaryData()));
        int256 oraclePrice = optimisticOracle.settleAndGetPrice(priceIdentifier, requestedTime, _getAncillaryData());

        if (oraclePrice < 0) oraclePrice = 0;
        return uint256(oraclePrice);
    }

    function _requestOraclePriceExpiration() internal {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        // For now, we add no fees the the OO and set the reward to 0.
        optimisticOracle.requestPrice(priceIdentifier, expirationTimestamp, _getAncillaryData(), collateralToken, 0);
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    function _getAncillaryData() internal view returns (bytes memory) {
        return abi.encodePacked(address(longToken), address(shortToken));
    }
}
