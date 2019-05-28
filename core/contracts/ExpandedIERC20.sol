/*
  ExpandedIERC20 contract.
  Interface that expands IERC20 to include burning and minting tokens.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


contract ExpandedIERC20 is IERC20 {
    // Burns a specific amount of tokens. Burns the sender's tokens, so it is safe to leave this method permissionless.
    function burn(uint value) external;

    // Mints tokens and adds them to the balance of the `to` address.
    // Note: this method should be permissioned to only allow designated parties to mint tokens.
    function mint(address to, uint value) external;
}
