// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/Withdrawable.sol";
import "./DesignatedVotingV2.sol";

/**
 * @title Factory to deploy new instances of DesignatedVotingV2 and look up previously deployed instances.
 * @dev Allows off-chain infrastructure to look up a hot wallet's deployed DesignatedVoting contract.
 */
contract DesignatedVotingV2Factory is Withdrawable {
    address private finder;
    mapping(address => DesignatedVotingV2) public designatedVotingContracts;

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
     * @return designatedVoting a new DesignatedVoting contract.
     */
    function newDesignatedVoting(address ownerAddress) external returns (DesignatedVotingV2) {
        DesignatedVotingV2 designatedVoting = new DesignatedVotingV2(finder, ownerAddress, msg.sender);
        designatedVotingContracts[msg.sender] = designatedVoting;
        return designatedVoting;
    }

    /**
     * @notice Associates a `DesignatedVoting` instance with `msg.sender`.
     * @param designatedVotingAddress address to designate voting to.
     * @dev This is generally only used if the owner of a `DesignatedVoting` contract changes their `voter`
     * address and wants that reflected here.
     */
    function setDesignatedVoting(address designatedVotingAddress) external {
        designatedVotingContracts[msg.sender] = DesignatedVotingV2(designatedVotingAddress);
    }
}
