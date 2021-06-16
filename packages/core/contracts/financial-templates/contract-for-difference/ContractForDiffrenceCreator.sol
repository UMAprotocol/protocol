// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/interfaces/ExpandedIERC20.sol";
import "../../common/interfaces/IERC20Standard.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/ContractCreator.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/AddressWhitelist.sol";
import "../../common/implementation/Lockable.sol";
import "../common/TokenFactory.sol";
import "../common/SyntheticToken.sol";
import "./ContractForDifference.sol";
import "../common/financial-product-libraries/contract-for-difference-libraries/ContractForDifferenceFinancialProductLibrary.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Contract For Difference Contract Creator.
 * @notice Factory contract to create and register new instances of contract for difference contracts.
 * Responsible for constraining the parameters used to construct a new CFD. These constraints can evolve over time and
 * are initially constrained to conservative values in this first iteration.
 */
contract ContractForDifferenceCreator is Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20Standard;

    // Address of TokenFactory used to create a new synthetic token.
    TokenFactory public tokenFactory;

    FinderInterface public finder;

    event CreatedContractForDifference(address indexed contractForDifference, address indexed deployerAddress);

    /**
     * @notice Constructs the ContractForDifferenceCreator contract.
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
     * @param expirationTimestamp unix timestamp of when the contract will expire.
     * @param collateralPerPair how many units of collateral are required to mint one pair of synthetic tokens.
     * @param priceIdentifier registered in the DVM for the synthetic.
     * @param syntheticName Name of the synthetic tokens to be created. The long tokens will have "Long Token" appended
     *     to the end and the short token will "Short Token" appended to the end to distinguish within the CFD's tokens.
     * @param syntheticSymbol Symbol of the synthetic tokens to be created. The long tokens will have "l" appended
     *     to the start and the short token will "s" appended to the start to distinguish within the CFD's tokens.
     * @param collateralToken ERC20 token used as as collateral in the CFD.
     * @param financialProductLibrary Contract providing settlement payout logic.
     * @param customAncillaryData Custom ancillary data to be passed along with the price request. If not needed, this
     *                             should be left as a 0-length bytes array.
     * @notice The created CFD is NOT registered within the registry as the CFD contract uses the DVM.
     * @notice The CFD constructor does a number of validations on input params. These are not repeated here.
     */
    function createContractForDifference(
        uint64 expirationTimestamp,
        uint256 collateralPerPair,
        bytes32 priceIdentifier,
        string memory syntheticName,
        string memory syntheticSymbol,
        IERC20Standard collateralToken,
        ContractForDifferenceFinancialProductLibrary financialProductLibrary,
        bytes memory customAncillaryData,
        uint256 prepaidProposerReward
    ) public nonReentrant() returns (address) {
        // Create a new synthetic token using the params.
        require(bytes(syntheticName).length != 0, "Missing synthetic name");
        require(bytes(syntheticSymbol).length != 0, "Missing synthetic symbol");

        // If the collateral token does not have a `decimals()` method, then a default precision of 18 will be
        // applied to the newly created synthetic token.
        uint8 collateralDecimals = _getSyntheticDecimals(collateralToken);
        ExpandedIERC20 longToken =
            tokenFactory.createToken(
                string(abi.encodePacked(syntheticName, " Long Token")),
                string(abi.encodePacked("l", syntheticSymbol)),
                collateralDecimals
            );
        ExpandedIERC20 shortToken =
            tokenFactory.createToken(
                string(abi.encodePacked(syntheticName, " Short Token")),
                string(abi.encodePacked("s", syntheticSymbol)),
                collateralDecimals
            );
        ContractForDifference cfd =
            new ContractForDifference(
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
            collateralToken.safeTransferFrom(msg.sender, address(cfd), prepaidProposerReward);

        address cfdAddress = address(cfd);

        // Give permissions to new cfd contract and then hand over ownership.
        longToken.addMinter(cfdAddress);
        longToken.addBurner(cfdAddress);
        longToken.resetOwner(cfdAddress);

        shortToken.addMinter(cfdAddress);
        shortToken.addBurner(cfdAddress);
        shortToken.resetOwner(cfdAddress);

        emit CreatedContractForDifference(cfdAddress, msg.sender);

        return cfdAddress;
    }

    /****************************************
     *          PRIVATE FUNCTIONS           *
     ****************************************/

    // IERC20Standard.decimals() will revert if the collateral contract has not implemented the decimals() method,
    // which is possible since the method is only an OPTIONAL method in the ERC20 standard:
    // https://eips.ethereum.org/EIPS/eip-20#methods.
    function _getSyntheticDecimals(IERC20Standard _collateralToken) public view returns (uint8 decimals) {
        try _collateralToken.decimals() returns (uint8 _decimals) {
            return _decimals;
        } catch {
            return 18;
        }
    }
}
