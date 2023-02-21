// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "./DesignatedVotingV2.sol";
import "../../common/implementation/MultiCaller.sol";

/**
 * @title Factory to deploy new instances of DesignatedVotingV2 and look up previously deployed instances.
 * @dev Allows off-chain infrastructure to look up a hot wallet's deployed DesignatedVoting contract.
 */
contract DesignatedVotingV2Factory is MultiCaller {
    address public immutable finder; // Finder contract that stores addresses of UMA system contracts.

    event NewDesignatedVoting(address indexed voter, address indexed owner, address indexed designatedVoting);

    /**
     * @notice Construct the DesignatedVotingFactory contract.
     * @param _finder keeps track of all contracts within the system based on their interfaceName.
     */
    constructor(address _finder) {
        finder = _finder;
    }

    /**
     * @notice Deploys a new `DesignatedVoting` contract.
     * @param owner defines who will own the deployed instance of the designatedVoting contract.
     * @param voter defines who will be able to vote on behalf of the owner, using the designatedVoting contract.
     * @return designatedVoting a new DesignatedVoting contract.
     */
    function newDesignatedVoting(address owner, address voter) external returns (DesignatedVotingV2) {
        DesignatedVotingV2 designatedVoting = new DesignatedVotingV2(finder, owner, voter);

        emit NewDesignatedVoting(voter, owner, address(designatedVoting));

        return designatedVoting;
    }
}
