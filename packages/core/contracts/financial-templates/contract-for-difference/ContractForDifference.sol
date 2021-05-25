// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

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

abstract contract ContractForDifference is Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ExpandedIERC20;
    using Address for address;

    enum ContractState { Open, ExpiredPriceRequested, ExpiredPriceReceived }
    ContractState public contractState;

    uint32 public expirationTimestamp;

    uint256 public collateralPerUnit;

    bytes32 public priceIdentifier;

    IERC20 public collateralToken;
    IERC20 public longToken;
    IERC20 public shortToken;

    FinderInterface public finder;

    ContractForDifferenceFinancialProductLibrary public financialProductLibrary;

    modifier onlyPreExpiration() {
        _onlyPreExpiration();
        _;
    }

    modifier onlyPostExpiration() {
        _onlyPostExpiration();
        _;
    }

    modifier onlyOpenState() {
        _onlyOpenState();
        _;
    }

    constructor(
        uint32 _expirationTimestamp,
        uint256 _collateralPerUnit,
        address _longTokenAddress,
        address _shortTokenAddress,
        address _finderAddress,
        bytes32 _priceIdentifier,
        address _collateralAddress,
        address _financialProductLibrary,
        address _timerAddress
    ) Testable(_timerAddress) {
        collateralToken = IERC20(_collateralAddress);
        finder = FinderInterface(_finderAddress);
        require(_expirationTimestamp > getCurrentTime());
        require(_getIdentifierWhitelist().isIdentifierSupported(_priceIdentifier));
        require(_financialProductLibrary != address(0));

        expirationTimestamp = _expirationTimestamp;
        collateralPerUnit = _collateralPerUnit;
        longToken = IERC20(_longTokenAddress);
        shortToken = IERC20(_shortTokenAddress);
        collateralToken = ExpandedIERC20(_collateralAddress);
        priceIdentifier = _priceIdentifier;

        financialProductLibrary = ContractForDifferenceFinancialProductLibrary(_financialProductLibrary);
    }

    function mint(uint256 tokensToMint) public onlyPreExpiration() nonReentrant() returns (uint256 collateralUsed) {}

    function redeem(uint256 tokensToRedeem)
        public
        onlyPreExpiration()
        nonReentrant()
        returns (uint256 collateralReturned)
    {}

    function expire() public onlyPostExpiration() onlyOpenState() nonReentrant() {}

    function settleExpired(uint256 longTokensToRedeem, uint256 shortTokensToRedeem)
        public
        onlyPostExpiration
        returns (uint256 collateralReturned)
    {}

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    function _onlyOpenState() internal view {
        require(contractState == ContractState.Open, "Contract state is not OPEN");
    }

    function _onlyPreExpiration() internal view {
        require(getCurrentTime() < expirationTimestamp, "Only callable pre-expiry");
    }

    function _onlyPostExpiration() internal view {
        require(getCurrentTime() >= expirationTimestamp, "Only callable post-expiry");
    }
}
