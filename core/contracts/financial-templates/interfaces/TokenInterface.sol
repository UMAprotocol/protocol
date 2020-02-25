pragma solidity ^0.6.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Interface for mintable and burnable tokens.
 * @dev Technically this is not an "interface" because PricelessPositionManager needs to use SafeERC20 for TokenInterface
 * in order to make safeTransferFrom() calls. However, you cannot use the "using" keyword with interfaces
 */
contract TokenInterface is IERC20 {
    /**
     * @dev Creates new tokens and sends to account.
     *
     * Requirements:
     *
     * - the caller must have the minter role.
     */
    function mint(address account, uint256 amount) external returns (bool);

    /**
     * @dev Destroys `amount` tokens from the caller.
     *
     * Requirements:
     *
     * - the caller must have the burner role.
     */
    function burn(uint256 amount) external;
}
