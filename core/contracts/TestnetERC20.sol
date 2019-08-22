pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";


/**
 * @title TestnetERC20
 * @dev This is just an implementation that has the same interface as the Compound project's testnet tokens (mainly
 * DAI). This contract can be deployed or the interface can be used to communicate with Compound's ERC20 tokens.
 * Note: this token should never be used to store real value since it allows permissionless minting.
 */
contract TestnetERC20 is ERC20 {

    // Sample token information.
    string public constant name = "Dai"; // solhint-disable-line const-name-snakecase
    string public constant symbol = "DAI"; // solhint-disable-line const-name-snakecase
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    /**
     * @notice Mints value tokens to the owner address.
     */
    function allocateTo(address _owner, uint value) external {
        _mint(_owner, value);
    }
}
