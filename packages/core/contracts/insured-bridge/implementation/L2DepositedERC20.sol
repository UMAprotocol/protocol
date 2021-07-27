// SPDX-License-Identifier: MIT LICENSE
pragma solidity >0.5.0 <0.8.0;
pragma experimental ABIEncoderV2;

/* Contract Imports */
import { L1ERC20 } from "./L1ERC20.sol";

interface IL2StandardERC20 {
    function l1Token() external returns (address);

    function mint(address _to, uint256 _amount) external;

    function burn(address _from, uint256 _amount) external;

    event Mint(address indexed _account, uint256 _amount);
    event Burn(address indexed _account, uint256 _amount);
}

/* Library Imports */
// import { OVM_CrossDomainEnabled } from "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";

/**
 * @title L2DepositedERC20
 * @dev An L2 Deposited ERC20 is an ERC20 implementation which represents L1 assets deposited into L2, minting and burning on
 * deposits and withdrawals.
 *
 * `L2DepositedERC20` uses the Abs_L2DepositedToken class provided by optimism to link into a standard L1 deposit contract
 * while using the `ERC20`implementation I as a developer want to use.
 *
 * Compiler used: optimistic-solc
 * Runtime target: OVM
 */
contract L2DepositedERC20 is L1ERC20 {
    address public l1Token;

    /**
     * @param _l2CrossDomainMessenger Address of the L2 cross domain messenger.
     * @param _name Name for the ERC20 token.
     */
    constructor(
        address _l2CrossDomainMessenger,
        string memory _name,
        address _l1Token
    ) L1ERC20(0, _name) {
        l1Token = _l1Token;
    }

    /**
     * Handler that gets called when a withdrawal is initiated.
     * @param _to Address triggering the withdrawal.
     * @param _amount Amount being withdrawn.
     */
    function _handleInitiateWithdrawal(address _to, uint256 _amount) internal {
        _burn(msg.sender, _amount);
    }

    /**
     * Handler that gets called when a deposit is received.
     * @param _to Address receiving the deposit.
     * @param _amount Amount being deposited.
     */
    function _handleFinalizeDeposit(address _to, uint256 _amount) internal {
        _mint(_to, _amount);
    }

    function mint(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }

    function supportsInterface(bytes4 _interfaceId) public pure returns (bool) {
        // bytes4 firstSupportedInterface = bytes4(keccak256("supportsInterface(bytes4)")); // ERC165
        // bytes4 secondSupportedInterface =
        //     IL2StandardERC20.l1Token.selector ^ IL2StandardERC20.mint.selector ^ IL2StandardERC20.burn.selector;
        // return _interfaceId == firstSupportedInterface || _interfaceId == secondSupportedInterface;
        return true;
    }
}
