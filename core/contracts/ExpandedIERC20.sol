/**
 * ExpandedIERC20 contract.
 * Interface that expands IERC20 to include burning and minting tokens.
 */
pragma solidity 0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


/**
 * @title ERC20 interface that includes burn and mint methods.
 */
contract ExpandedIERC20 is IERC20 {
    /**
     * @notice Burns a specific amount of the caller's tokens.
     * @dev Only burns the caller's tokens, so it is safe to leave this method permissionless.
     */
    function burn(uint value) external;

    /**
     * @notice Mints tokens and adds them to the balance of the `to` address.
     * @dev This method should be permissioned to only allow designated parties to mint tokens.
     */
    function mint(address to, uint value) external returns (bool);
}
