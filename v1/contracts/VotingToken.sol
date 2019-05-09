pragma solidity ^0.5.0;

import "./MultiRole.sol";

import "openzeppelin-solidity/contracts/drafts/ERC20Snapshot.sol";


/**
 * @title UMA voting token
 * @dev Supports snapshotting and allows the Oracle to mint new tokens as rewards.
 */
contract VotingToken is ERC20Snapshot, MultiRole {

    enum Roles {
        // Can set the minter.
        Governance,
        // The Oracle contract (currently named Voting.sol) can mint new tokens as voting rewards.
        Minter
    }

    constructor() public {
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
        _createExclusiveRole(uint(Roles.Minter), uint(Roles.Governance), msg.sender);
    }

    /**
     * @dev Mints `value` tokens to `recipient`, returning true on success.
     */
    function mint(address recipient, uint value) external onlyRoleHolder(uint(Roles.Minter)) returns (bool) {
        _mint(recipient, value);
        return true;
    }
}
