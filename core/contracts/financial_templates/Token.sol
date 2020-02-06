pragma solidity ^0.5.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../ExpandedIERC20.sol";

/**
 * @notice A burnable and mintable ERC20.
 */
contract Token is ExpandedIERC20, ERC20 {
    function burn(uint value) external {
        _burn(msg.sender, value);
    }

    // TODO: Inherit from ERC20Mintable instead, which will require redefining ExpandedIERC20 to have this method be
    // public.
    function mint(address to, uint value) external returns (bool) {
        _mint(to, value);
        return true;
    }
}
