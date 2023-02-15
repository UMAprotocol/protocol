// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "./DesignatedVotingV2.sol";
import "../../common/implementation/MultiCaller.sol";

/**
 * @title Factory to deploy new instances of DesignatedVotingV2 and look up previously deployed instances.
 * @dev Allows off-chain infrastructure to look up a hot wallet's deployed DesignatedVoting contract.
 */
contract DesignatedVotingV2Factory {
    address private immutable finder; // Finder contract that stores addresses of UMA system contracts.

    /**
     * @notice Construct the DesignatedVotingFactory contract.
     * @param finderAddress keeps track of all contracts within the system based on their interfaceName.
     */
    constructor(address finderAddress) {
        finder = finderAddress;
    }

    /**
     * @notice Deploys a new `DesignatedVoting` contract.
     * @param ownerAddress defines who will own the deployed instance of the designatedVoting contract.
     * @param voterAddress defines who will be able to vote on behalf of the owner, using the designatedVoting contract.
     * @return designatedVoting a new DesignatedVoting contract.
     */
    function newDesignatedVoting(address ownerAddress, address voterAddress) external returns (DesignatedVotingV2) {
        DesignatedVotingV2 designatedVoting = new DesignatedVotingV2(finder, ownerAddress, voterAddress);

        emit NewDesignatedVoting(voterAddress, address(designatedVoting), ownerAddress);

        return designatedVoting;
    }
}
