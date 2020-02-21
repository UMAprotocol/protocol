pragma solidity ^0.5.0;
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

import "../interfaces/TokenInterface.sol";

/**
 * @notice A burnable and mintable ERC20.
 */
contract Token is TokenInterface, ERC20Detailed, ERC20Mintable, ERC20Burnable {
    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals)
        public
        ERC20Detailed(tokenName, tokenSymbol, tokenDecimals)
        ERC20Mintable()
        ERC20Burnable()
    {}
}
