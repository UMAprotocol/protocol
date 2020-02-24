pragma solidity ^0.5.0;
import "../../common/implementation/PermissionedExpandedERC20.sol";

/**
 * @title A permissioned burnable and mintable ERC20 designed to represent a collateralized synthetic token. 
 * @dev Methods to assign new Roles are neccessary because this token is expected
 * to be created via the factory method and therefore roles need to be passed on to callers
 * of the factory's methods from the factory contract itself.
 */
contract SyntheticToken is PermissionedExpandedERC20 {
    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals)
        public
        PermissionedExpandedERC20(tokenName, tokenSymbol, tokenDecimals)
    {}
}
