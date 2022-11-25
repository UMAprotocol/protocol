// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/interfaces/ExpandedIERC20.sol";
import "../../common/interfaces/IERC20Standard.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
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
        string pairName;
        uint64 expirationTimestamp;
        uint256 collateralPerPair;
        bytes32 priceIdentifier;
        bool enableEarlyExpiration;
        string longSynthName;
        string longSynthSymbol;
        string shortSynthName;
        string shortSynthSymbol;
        IERC20Standard collateralToken;
        LongShortPairFinancialProductLibrary financialProductLibrary;
        bytes customAncillaryData;
        uint256 proposerReward;
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

    /**
     * @notice Creates a longShortPair contract and associated long and short tokens.
     * @param params Constructor params used to initialize the LSP. Key-valued object with the following structure:
     *     - `pairName`: Name of the long short pair contract.
     *     - `expirationTimestamp`: Unix timestamp of when the contract will expire.
     *     - `collateralPerPair`: How many units of collateral are required to mint one pair of synthetic tokens.
     *     - `priceIdentifier`: Registered in the DVM for the synthetic.
     *     - `enableEarlyExpiration`: Enables the LSP contract to be settled early.
     *     - `longSynthName`: Name of the long synthetic tokens to be created.
     *     - `longSynthSymbol`: Symbol of the long synthetic tokens to be created.
     *     - `shortSynthName`: Name of the short synthetic tokens to be created.
     *     - `shortSynthSymbol`: Symbol of the short synthetic tokens to be created.
     *     - `collateralToken`: ERC20 token used as collateral in the LSP.
     *     - `financialProductLibrary`: Contract providing settlement payout logic.
     *     - `customAncillaryData`: Custom ancillary data to be passed along with the price request. If not needed, this
     *                              should be left as a 0-length bytes array.
     *     - `proposerReward`: Optimistic oracle reward amount, pulled from the caller of the expire function.
     *     - `optimisticOracleLivenessTime`: Optimistic oracle liveness time for price requests.
     *     - `optimisticOracleProposerBond`: Optimistic oracle proposer bond for price requests.
     * @return lspAddress the deployed address of the new long short pair contract.
     * @notice Created LSP is not registered within the registry as the LSP uses the Optimistic Oracle for settlement.
     * @notice The LSP constructor does a number of validations on input params. These are not repeated here.
     */
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

        // Deploy the LSP contract.
        LongShortPair lsp = new LongShortPair(_convertParams(params, longToken, shortToken));

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
    ) private view returns (LongShortPair.ConstructorParams memory constructorParams) {
        // Input from function call.
        constructorParams.pairName = creatorParams.pairName;
        constructorParams.expirationTimestamp = creatorParams.expirationTimestamp;
        constructorParams.collateralPerPair = creatorParams.collateralPerPair;
        constructorParams.priceIdentifier = creatorParams.priceIdentifier;
        constructorParams.enableEarlyExpiration = creatorParams.enableEarlyExpiration;
        constructorParams.collateralToken = creatorParams.collateralToken;
        constructorParams.financialProductLibrary = creatorParams.financialProductLibrary;
        constructorParams.customAncillaryData = creatorParams.customAncillaryData;
        constructorParams.proposerReward = creatorParams.proposerReward;
        constructorParams.optimisticOracleLivenessTime = creatorParams.optimisticOracleLivenessTime;
        constructorParams.optimisticOracleProposerBond = creatorParams.optimisticOracleProposerBond;

        // Constructed long & short synthetic tokens.
        constructorParams.longToken = longToken;
        constructorParams.shortToken = shortToken;

        // Finder and timer. Should be the same as that used in this factory contract.
        constructorParams.finder = finder;
        constructorParams.timerAddress = timerAddress;
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
