// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";

import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "./OptimisticRewarder.sol";

/**
 * @notice The creator contract for optimistic rewarders. Using this contract is totally optional. It only aids in
 * creating a simpler deployment experience with a guarantee of repeatable verification and easier tracking through
 * events.
 */
contract OptimisticRewarderCreator is Lockable {
    FinderInterface public finder;

    event CreatedOptimisticRewarder(address indexed optimisticRewarder, bool includesToken);

    constructor(FinderInterface _finder) {
        finder = _finder;
    }

    /**
     * @notice Deploys an optimistic rewarder.
     * @param _name name for the ERC721 token.
     * @param _symbol symbol for the ERC721 token.
     * @param _baseUri prefix to each ERC721 tokenId's name.
     * @param _liveness liveness period between submission and verification of a reward.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _bond size of the bond.
     * @param _identifier identifier that should be passed to the optimistic oracle on dispute.
     * @param _customAncillaryData custom ancillary data that should be sent to the optimistic oracle on dispute.
     */
    function createOptimisticRewarder(
        string memory _name,
        string memory _symbol,
        string memory _baseUri,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        bytes memory _customAncillaryData
    ) public nonReentrant returns (address) {
        OptimisticRewarder optimisticRewarder =
            new OptimisticRewarder(
                _name,
                _symbol,
                _baseUri,
                _liveness,
                _bondToken,
                _bond,
                _identifier,
                _customAncillaryData,
                finder
            );
        emit CreatedOptimisticRewarder(address(optimisticRewarder), true);
        return address(optimisticRewarder);
    }

    /**
     * @notice Deploys an optimistic rewarder with an external ERC721 token.
     * @param _token external ERC721 token for the rewarder to base redemptions on.
     * @param _liveness liveness period between submission and verification of a reward.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _bond size of the bond.
     * @param _identifier identifier that should be passed to the optimistic oracle on dispute.
     * @param _customAncillaryData custom ancillary data that should be sent to the optimistic oracle on dispute.
     */
    function createOptimisticRewarderNoToken(
        OptimisticRewarderToken _token,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        bytes memory _customAncillaryData
    ) public nonReentrant returns (address) {
        OptimisticRewarderNoToken optimisticRewarder =
            new OptimisticRewarderNoToken(
                _token,
                _liveness,
                _bondToken,
                _bond,
                _identifier,
                _customAncillaryData,
                finder
            );
        emit CreatedOptimisticRewarder(address(optimisticRewarder), false);
        return address(optimisticRewarder);
    }
}
