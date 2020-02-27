pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "../../common/implementation/Withdrawable.sol";
import "./DesignatedVoting.sol";

/**
 * @title Factory to deploy new instances of DesignatedVoting and look up previously deployed instances.
 * @dev Allows off-chain infrastructure to look up a hot wallet's deployed DesignatedVoting contract.
 */
contract DesignatedVotingFactory is Withdrawable {
    /****************************************
     *    INTERNAL VARIABLES AND STORAGE    *
     ****************************************/

    enum Roles {
        Withdrawer // Can withdraw any ETH or ERC20 sent accidentally to this contract.
    }

    address private finder;
    mapping(address => DesignatedVoting) public designatedVotingContracts;

    /**
     * @notice Construct the DesignatedVotingFactory contract.
     * @param finderAddress keeps track of all contracts within the system based on their interfaceName.
     */
    constructor(address finderAddress) public {
        finder = finderAddress;

        createWithdrawRole(uint(Roles.Withdrawer), uint(Roles.Withdrawer), msg.sender);
    }

    /**
     * @notice Deploys a new `DesignatedVoting` contract.
     * @param ownerAddress defines who will own the deployed instance of the designatedVoting contract.
     * @return designatedVoting.
     */
    function newDesignatedVoting(address ownerAddress) external returns (DesignatedVoting designatedVoting) {
        require(address(designatedVotingContracts[msg.sender]) == address(0), "Duplicate hot key not permitted");

        designatedVoting = new DesignatedVoting(finder, ownerAddress, msg.sender);
        designatedVotingContracts[msg.sender] = designatedVoting;
    }

    /**
     * @notice Associates a `DesignatedVoting` instance with `msg.sender`.
     * @param designatedVotingAddress the address to designate voting to.
     * @dev This is generally only used if the owner of a `DesignatedVoting` contract changes their `voter` address and
     * wants that reflected here.
     */
    function setDesignatedVoting(address designatedVotingAddress) external {
        require(address(designatedVotingContracts[msg.sender]) == address(0), "Duplicate hot key not permitted");
        designatedVotingContracts[msg.sender] = DesignatedVoting(designatedVotingAddress);
    }
}
