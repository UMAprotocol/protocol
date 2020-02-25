pragma solidity ^0.5.0;


/**
 * @title Used internally by Truffle migrations.
 * @dev See https://www.trufflesuite.com/docs/truffle/getting-started/running-migrations#initial-migration for details.
 */
contract Migrations {
    address public owner;
    uint public last_completed_migration;

    constructor() public {
        owner = msg.sender;
    }

    modifier restricted() {
        if (msg.sender == owner) _;
    }

    function setCompleted(uint completed) public restricted {
        last_completed_migration = completed;
    }

    function upgrade(address new_address) public restricted {
        Migrations upgraded = Migrations(new_address);
        upgraded.setCompleted(last_completed_migration);
    }
}
