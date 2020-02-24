pragma solidity ^0.5.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ERC20 interface that includes burn and mint methods.
 */
contract ExpandedIERC20 is IERC20 {
    /**
     * @notice Destroys `value` of the caller's tokens.
     * @dev This method should be permissioned if you want to limit which parties can destroy tokens.
     */
    function burn(uint value) external;

    /**
     * @notice Mints `value` tokens and adds them to the balance of the `to` address.
     * @dev This method should be permissioned to only allow designated parties to mint tokens.
     */
    function mint(address to, uint value) external returns (bool);
}
