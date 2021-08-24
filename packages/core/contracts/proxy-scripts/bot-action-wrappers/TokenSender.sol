// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/ExpandedERC20.sol";

contract TokenSender {
    function transferERC20(
        address tokenAddress,
        address recipientAddress,
        uint256 amount
    ) public returns (bool) {
        IERC20 token = IERC20(tokenAddress);
        token.transfer(recipientAddress, amount);
        return true;
    }
}
