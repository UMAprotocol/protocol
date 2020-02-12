pragma solidity ^0.5.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Interface for mintable and burnable token. Adds methods to IERC20 that PricelessPositionManager calls.
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
     * @dev Add minter role for account
     *
     * Requirements:
     *
     * - the caller must have the {MinterRole}.
     */
    function addMinter(address account) external;

    // /**
    //  * @dev Moves `amount` tokens from `sender` to `recipient` using the
    //  * allowance mechanism. `amount` is then deducted from the caller's
    //  * allowance.
    //  *
    //  * Returns a boolean value indicating whether the operation succeeded.
    //  *
    //  * Emits a {Transfer} event.
    //  */
    // function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    /**
     * @dev Destroys `amount` tokens from the caller.
     *
     * See {ERC20-_burn}.
     */
    function burn(uint256 amount) external;
}
