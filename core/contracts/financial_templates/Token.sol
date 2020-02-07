pragma solidity ^0.5.0;
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

/**
 * @notice A burnable and mintable ERC20.
 */
contract Token is ERC20Detailed, ERC20Mintable, ERC20Burnable {
    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals)
        public
        ERC20Detailed(tokenName, tokenSymbol, tokenDecimals)
    {}
}
