pragma solidity ^0.6.0;

import "./ExpandedIERC20.sol";


/**
 * @title ERC20 interface that includes burn and mint methods as well as permissioning methods.
 */
abstract contract ExpandedIERC20ExclusiveMinter is ExpandedIERC20 {
    function resetMinter(address account) external virtual;

    function addBurner(address account) external virtual;

    function resetOwner(address account) external virtual;
}
