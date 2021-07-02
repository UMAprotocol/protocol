// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/interfaces/ExpandedIERC20.sol";
import "../../common/interfaces/IERC20Standard.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../common/TokenFactory.sol";
import "./LongShortPair.sol";
import "../common/financial-product-libraries/long-short-pair-libraries/LongShortPairFinancialProductLibrary.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Long Short Pair Contract Creator.
 * @notice Factory contract to create new instances of long short pair contracts.
 * Responsible for constraining the parameters used to construct a new LSP. These constraints can evolve over time and
 * are initially constrained to conservative values in this first iteration.
 */
contract LongShortPairCreator is Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20Standard;

    struct CreatorParams {
        string pairName; // Name of the long short pair contract.
        uint64 expirationTimestamp; // Unix timestamp of when the contract will expire.
        uint256 collateralPerPair; // How many units of collateral are required to mint one pair of synthetic tokens.
        bytes32 priceIdentifier; // Price identifier, registered in the DVM for the long short pair.
        string longSynthName;
        string longSynthSymbol;
        string shortSynthName;
        string shortSynthSymbol;
        IERC20Standard collateralToken;
        LongShortPairFinancialProductLibrary financialProductLibrary;
        bytes customAncillaryData;
        uint256 prepaidProposerReward;
        uint256 optimisticOracleLivenessTime;
        uint256 optimisticOracleProposerBond;
    }

    // Address of TokenFactory used to create a new synthetic token.
    TokenFactory public tokenFactory;

    FinderInterface public finder;

    event CreatedLongShortPair(
        address indexed longShortPair,
        address indexed deployerAddress,
        address longToken,
        address shortToken
    );

    /**
     * @notice Constructs the LongShortPairCreator contract.
     * @param _finder UMA protocol Finder used to discover other protocol contracts.
     * @param _tokenFactory ERC20 token factory used to deploy synthetic token instances.
     * @param _timer Contract that stores the current time in a testing environment.
     */
    constructor(
        FinderInterface _finder,
        TokenFactory _tokenFactory,
        address _timer
    ) Testable(_timer) nonReentrant() {
        tokenFactory = _tokenFactory;
        finder = _finder;
    }

    function createLongShortPair(CreatorParams memory params) public nonReentrant() returns (address) {
        // Create a new synthetic token using the params.
        require(bytes(params.longSynthName).length != 0, "Missing long synthetic name");
        require(bytes(params.shortSynthName).length != 0, "Missing short synthetic name");
        require(bytes(params.longSynthSymbol).length != 0, "Missing long synthetic symbol");
        require(bytes(params.shortSynthSymbol).length != 0, "Missing short synthetic symbol");

        // If the collateral token does not have a `decimals()` method, then a default precision of 18 will be
        // applied to the newly created synthetic token.
        uint8 collateralDecimals = _getSyntheticDecimals(params.collateralToken);
        ExpandedIERC20 longToken =
            tokenFactory.createToken(params.longSynthName, params.longSynthSymbol, collateralDecimals);
        ExpandedIERC20 shortToken =
            tokenFactory.createToken(params.shortSynthName, params.shortSynthSymbol, collateralDecimals);

        // Deploy the LPS contract.
        LongShortPair lsp = new LongShortPair(_convertParams(params, longToken, shortToken), finder, timerAddress);

        // Move prepaid proposer reward from the deployer to the newly deployed contract.
        if (params.prepaidProposerReward > 0)
            params.collateralToken.safeTransferFrom(msg.sender, address(lsp), params.prepaidProposerReward);

        address lspAddress = address(lsp);

        // Give permissions to new lsp contract and then hand over ownership.
        longToken.addMinter(lspAddress);
        longToken.addBurner(lspAddress);
        longToken.resetOwner(lspAddress);

        shortToken.addMinter(lspAddress);
        shortToken.addBurner(lspAddress);
        shortToken.resetOwner(lspAddress);

        emit CreatedLongShortPair(lspAddress, msg.sender, address(longToken), address(shortToken));

        return lspAddress;
    }

    // Converts createLongShortPair creator params to LongShortPair constructor params.
    function _convertParams(
        CreatorParams memory creatorParams,
        ExpandedIERC20 longToken,
        ExpandedIERC20 shortToken
    ) private pure returns (LongShortPair.ConstructorParams memory constructorParams) {
        // Input from function call.
        constructorParams.pairName = creatorParams.pairName;
        constructorParams.expirationTimestamp = creatorParams.expirationTimestamp;
        constructorParams.collateralPerPair = creatorParams.collateralPerPair;
        constructorParams.priceIdentifier = creatorParams.priceIdentifier;
        constructorParams.collateralToken = creatorParams.collateralToken;
        constructorParams.financialProductLibrary = creatorParams.financialProductLibrary;
        constructorParams.customAncillaryData = creatorParams.customAncillaryData;
        constructorParams.prepaidProposerReward = creatorParams.prepaidProposerReward;
        constructorParams.optimisticOracleLivenessTime = creatorParams.optimisticOracleLivenessTime;
        constructorParams.optimisticOracleProposerBond = creatorParams.optimisticOracleProposerBond;

        // Constructed long & short synthetic tokens.
        constructorParams.longToken = longToken;
        constructorParams.shortToken = shortToken;
    }

    // IERC20Standard.decimals() will revert if the collateral contract has not implemented the decimals() method,
    // which is possible since the method is only an OPTIONAL method in the ERC20 standard:
    // https://eips.ethereum.org/EIPS/eip-20#methods.
    function _getSyntheticDecimals(IERC20Standard _collateralToken) private view returns (uint8 decimals) {
        try _collateralToken.decimals() returns (uint8 _decimals) {
            return _decimals;
        } catch {
            return 18;
        }
    }
}
