pragma solidity ^0.5.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Interface for mintable and burnable token.
 * @dev Technically this is not an "interface" because PricelessPositionManager needs to use SafeERC20 for TokenInterface
 * in order to make safeTransferFrom() calls. However, you cannot use the "using" keyword with interfaces
 */
contract TokenInterface is IERC20 {
    /**
     * @dev See {ERC20-_mint}.
     *
     * Requirements:
     *
     * - the caller must have the {MinterRole}.
     */
    function mint(address account, uint256 amount) external returns (bool);

    /**
     * @dev Set minter role to account
     *
     * Requirements:
     *
     * - the caller must have the {MinterRole}.
     */
    function resetMinter(address account) external;

    /**
     * @dev Destroys `amount` tokens from the caller.
     *
     * See {ERC20-_burn}.
     */
    function burn(uint256 amount) external;
}
