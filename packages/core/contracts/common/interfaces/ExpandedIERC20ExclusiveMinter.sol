pragma solidity ^0.6.0;

import "./ExpandedIERC20.sol";


/**
 * @title ERC20 interface that includes burn and mint methods
 * as well as a method to check that the contract has an exclusive minter role.
 */
abstract contract ExpandedIERC20ExclusiveMinter is ExpandedIERC20 {
    /**
     * @notice Returns true if the Minter roleId represents an initialized, exclusive roleId, or reverts.
     * @return True if the Minter's roleId represents an Exclusive role.
     */
    function isMinterExclusive() public virtual view returns (bool);
}
