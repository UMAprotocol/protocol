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

/**
 * @title Contract For Difference Contract creator.
 * @notice Factory contract to create and register new instances of contract for difference contracts.
 * Responsible for constraining the parameters used to construct a new CFD. These constraints can evolve over time and are
 * initially constrained to conservative values in this first iteration.
 */
contract ContractForDifferenceCreator is Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;

    // Address of TokenFactory used to create a new synthetic token.
    address public tokenFactoryAddress;

    address public finderAddress;

    event CreatedContractForDifference(address indexed contractForDifference, address indexed deployerAddress);

    /**
     * @notice Constructs the ContractForDifferenceCreator contract.
     * @param _finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param _tokenFactoryAddress ERC20 token factory used to deploy synthetic token instances.
     * @param _timerAddress Contract that stores the current time in a testing environment.
     */
    constructor(
        address _finderAddress,
        address _tokenFactoryAddress,
        address _timerAddress
    ) Testable(_timerAddress) nonReentrant() {
        tokenFactoryAddress = _tokenFactoryAddress;
        finderAddress = _finderAddress;
    }

    /**
     * @param expirationTimestamp unix timestamp of when the contract will expire.
     * @param collateralPerPair how many units of collateral are required to mint one pair of synthetic tokens.
     * @param priceIdentifier registered in the DVM for the synthetic.
     * @param syntheticName Name of the synthetic tokens to be created. The long tokens will have "Long Token" appended
     *     to the end and the short token will "Short Token" appended to the end to distinguish within the CFD's tokens.
     * @param syntheticSymbol Symbol of the synthetic tokens to be created. The long tokens will have "l" appended
     *     to the start and the short token will "s" appended to the start to distinguish within the CFD's tokens.
     * @param collateralAddress ERC20 token used as as collateral in the CFD.
     * @param financialProductLibraryAddress Contract providing settlement payout logic.
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
        address collateralAddress,
        address financialProductLibraryAddress,
        bytes memory customAncillaryData
    ) public nonReentrant() returns (address) {
        // Create a new synthetic token using the params.
        require(bytes(syntheticName).length != 0, "Missing synthetic name");
        require(bytes(syntheticSymbol).length != 0, "Missing synthetic symbol");
        TokenFactory tf = TokenFactory(tokenFactoryAddress);

        // If the collateral token does not have a `decimals()` method, then a default precision of 18 will be
        // applied to the newly created synthetic token.
        uint8 collateralDecimals = _getSyntheticDecimals(collateralAddress);
        ExpandedIERC20 longToken =
            tf.createToken(
                string(abi.encodePacked(syntheticName, " Long Token")),
                string(abi.encodePacked("l", syntheticSymbol)),
                collateralDecimals
            );
        ExpandedIERC20 shortToken =
            tf.createToken(
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
                IERC20Standard(collateralAddress),
                FinderInterface(finderAddress),
                ContractForDifferenceFinancialProductLibrary(financialProductLibraryAddress),
                customAncillaryData,
                timerAddress
            );

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
    function _getSyntheticDecimals(address _collateralAddress) public view returns (uint8 decimals) {
        try IERC20Standard(_collateralAddress).decimals() returns (uint8 _decimals) {
            return _decimals;
        } catch {
            return 18;
        }
    }
}
