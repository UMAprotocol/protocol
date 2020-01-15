pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "./DesignatedVoting.sol";
import "./Finder.sol";
import "./Withdrawable.sol";

/**
 * @title Factory to allow looking up deployed DesignatedVoting instances
 * @dev Allows off-chain infrastructure, such as a dApp, to look up a hot wallet's deployed DesignatedVoting contract.
 */
contract DesignatedVotingFactory is Withdrawable {
    enum Roles {
        // Can withdraw any ETH or ERC20 sent accidentally to this contract.
        Withdrawer
    }

    address private finder;
    mapping(address => DesignatedVoting) public designatedVotingContracts;

    constructor(address finderAddress) public {
        finder = finderAddress;

        createWithdrawRole(uint(Roles.Withdrawer), uint(Roles.Withdrawer), msg.sender);
    }

    /**
     * @notice Deploys a new `DesignatedVoting` contract.
     */
    function newDesignatedVoting(address ownerAddress) external returns (DesignatedVoting designatedVoting) {
        require(address(designatedVotingContracts[msg.sender]) == address(0), "Duplicate hot key not permitted");

        designatedVoting = new DesignatedVoting(finder, ownerAddress, msg.sender);
        designatedVotingContracts[msg.sender] = designatedVoting;
    }

    /**
     * @notice Associates a `DesignatedVoting` instance with `msg.sender`.
     */
    function setDesignatedVoting(address designatedVotingAddress) external {
        require(address(designatedVotingContracts[msg.sender]) == address(0), "Duplicate hot key not permitted");
        designatedVotingContracts[msg.sender] = DesignatedVoting(designatedVotingAddress);
    }
}
