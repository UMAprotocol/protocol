pragma solidity ^0.5.0;

import "../Withdrawable.sol";


// WithdrawableTest is derived from the abstract contract Withdrawable for testing purposes.
contract WithdrawableTest is Withdrawable {

    enum Roles {
        Governance,
        Withdraw
    }

    // solhint-disable-next-line no-empty-blocks
    constructor() public {
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
        createWithdrawRole(uint(Roles.Withdraw), uint(Roles.Governance), msg.sender);
    }

    function pay() external payable {
        require(msg.value > 0);
    }
}
