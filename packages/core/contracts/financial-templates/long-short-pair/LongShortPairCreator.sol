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
     * @dev The caller must approve this contract to transfer `prepaidProposerReward` amount of collateral.
     * @param expirationTimestamp unix timestamp of when the contract will expire.
     * @param collateralPerPair how many units of collateral are required to mint one pair of synthetic tokens.
     * @param priceIdentifier registered in the DVM for the synthetic.
     * @param longSynthName Name of the long synthetic tokens to be created.
     * @param longSynthSymbol Symbol of the long synthetic tokens to be created.
     * @param shortSynthName Name of the short synthetic tokens to be created.
     * @param shortSynthSymbol Symbol of the short synthetic tokens to be created.
     * @param collateralToken ERC20 token used as collateral in the LSP.
     * @param financialProductLibrary Contract providing settlement payout logic.
     * @param customAncillaryData Custom ancillary data to be passed along with the price request. If not needed, this
     *                             should be left as a 0-length bytes array.
     * @param prepaidProposerReward Proposal reward forwarded to the created LSP to incentivize price proposals.
     * @return lspAddress the deployed address of the new long short pair contract.
     * @notice Created LSP is not registered within the registry as the LSP uses the Optimistic Oracle for settlement.
     * @notice The LSP constructor does a number of validations on input params. These are not repeated here.
     */
    function createLongShortPair(
        uint64 expirationTimestamp,
        uint256 collateralPerPair,
        bytes32 priceIdentifier,
        string memory longSynthName,
        string memory longSynthSymbol,
        string memory shortSynthName,
        string memory shortSynthSymbol,
        IERC20Standard collateralToken,
        LongShortPairFinancialProductLibrary financialProductLibrary,
        bytes memory customAncillaryData,
        uint256 prepaidProposerReward
    ) public nonReentrant() returns (address) {
        // Create a new synthetic token using the params.
        require(bytes(longSynthName).length != 0, "Missing long synthetic name");
        require(bytes(shortSynthName).length != 0, "Missing short synthetic name");
        require(bytes(longSynthSymbol).length != 0, "Missing long synthetic symbol");
        require(bytes(shortSynthSymbol).length != 0, "Missing short synthetic symbol");

        // If the collateral token does not have a `decimals()` method, then a default precision of 18 will be
        // applied to the newly created synthetic token.
        uint8 collateralDecimals = _getSyntheticDecimals(collateralToken);
        ExpandedIERC20 longToken = tokenFactory.createToken(longSynthName, longSynthSymbol, collateralDecimals);
        ExpandedIERC20 shortToken = tokenFactory.createToken(shortSynthName, shortSynthSymbol, collateralDecimals);
        LongShortPair lsp =
            new LongShortPair(
                expirationTimestamp,
                collateralPerPair,
                priceIdentifier,
                longToken,
                shortToken,
                collateralToken,
                finder,
                financialProductLibrary,
                customAncillaryData,
                prepaidProposerReward,
                timerAddress
            );

        // Move prepaid proposer reward from the deployer to the newly deployed contract.
        if (prepaidProposerReward > 0)
            collateralToken.safeTransferFrom(msg.sender, address(lsp), prepaidProposerReward);

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
