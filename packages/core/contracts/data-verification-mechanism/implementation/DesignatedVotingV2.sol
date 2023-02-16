// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../../common/implementation/MultiCaller.sol";
import "../../common/implementation/Stakeable.sol";
import "../interfaces/FinderInterface.sol";
import "./Constants.sol";

/**
 * @title Proxy to allow voting from another address.
 * @dev Allows a UMA token holder to designate another address to vote on their behalf.
 * Each voter must deploy their own instance of this contract.
 */
contract DesignatedVotingV2 is Stakeable, MultiCaller {
    /****************************************
     *    INTERNAL VARIABLES AND STORAGE    *
     ****************************************/

    enum Roles {
        Owner, // Can set the Voter role.
        Voter // Can vote through this contract.
    }

    // Reference to UMA Finder contract, allowing Voting upgrades to be without requiring any calls to this contract.
    FinderInterface public immutable finder;

    /**
     * @notice Construct the DesignatedVotingV2 contract.
     * @param finderAddress keeps track of all contracts within the system based on their interfaceName.
     * @param ownerAddress address of the owner of the DesignatedVotingV2 contract.
     * @param voterAddress address to which the owner has delegated their voting power.
     */
    constructor(
        address finderAddress,
        address ownerAddress,
        address voterAddress
    ) {
        _createExclusiveRole(uint256(Roles.Owner), uint256(Roles.Owner), ownerAddress);
        _createExclusiveRole(uint256(Roles.Voter), uint256(Roles.Owner), voterAddress);
        _setWithdrawRole(uint256(Roles.Owner));
        _setStakeRole(uint256(Roles.Owner));

        finder = FinderInterface(finderAddress);
    }

    /**
     * @notice This method essentially syncs the voter role with the current voting delegate.
     * @dev Because this is essentially a state sync method, there is no reason to restrict its permissioning.
     */
    function delegateToVoter() public {
        address voter = getMember(uint256(Roles.Voter));
        _getVotingContract().setDelegate(voter);
    }

    // Returns the Voting contract address, named "Oracle" in the finder.
    function _getVotingContract() private view returns (StakerInterface) {
        return StakerInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }
}
