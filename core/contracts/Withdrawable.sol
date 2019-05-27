/*
    Contract that allows the owner to withdraw any ETH and/or ERC20 tokens that the contract holds.
*/

pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./MultiRole.sol";


contract Withdrawable is MultiRole {

    uint private _roleId;

    // Withdraws ETH from the contract.
    function withdraw(uint amount) external onlyRoleHolder(_roleId) {
        msg.sender.transfer(amount);
    }

    // Withdraws ERC20 tokens from the contract.
    function withdrawErc20(address erc20Address, uint amount) external onlyRoleHolder(_roleId) {
        IERC20 erc20 = IERC20(erc20Address);
        require(erc20.transfer(msg.sender, amount));
    }

    function createWithdrawRole(uint roleId, uint managingRoleId, address owner) internal {
        _roleId = roleId;
        _createExclusiveRole(roleId, managingRoleId, owner);
    }
}
