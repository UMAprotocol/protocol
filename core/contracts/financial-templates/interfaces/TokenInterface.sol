pragma solidity ^0.5.0;
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
     * @dev Add minter role to account.
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function addMinter(address account) external;

    /**
     * @dev Removes minter role from account.
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function removeMinter(address account) external;

    /**
     * @dev Destroys `amount` tokens from the caller.
     *
     * Requirements:
     *
     * - the caller must have the burner role.
     */
    function burn(uint256 amount) external;

    /**
     * @dev Add burner role to account
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function addBurner(address account) external;

    /**
     * @dev Removes burner role from account.
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function removeBurner(address account) external;

    /**
     * @dev Reset Owner role to account
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function resetOwner(address account) external;
}
