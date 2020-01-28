pragma solidity ^0.5.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../ExpandedIERC20.sol";

contract Token is ExpandedIERC20, ERC20 {
    function burn(uint value) external {
        _burn(msg.sender, value);
    }

    function mint(address to, uint value) external returns (bool) {
        _mint(to, value);
        return true;
    }
}
