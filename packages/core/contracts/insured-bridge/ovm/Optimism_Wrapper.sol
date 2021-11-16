// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Optimism Eth Wrapper
 * @dev Any ETH sent to this contract is wrapped into WETH and sent to the set bridge pool. This enables ETH to be sent
 * over the canonical Optimism bridge, which does not support WETH bridging.
 */
interface WETH9Like {
    function deposit() external payable;

    function transfer(address guy, uint256 wad) external;

    function balanceOf(address guy) external view returns (uint256);
}

contract Optimism_Wrapper is Ownable {
    WETH9Like public weth;
    address public bridgePool;

    event ChangedBridgePool(address indexed bridgePool);

    constructor(WETH9Like _weth, address _bridgePool) {
        weth = _weth;
        bridgePool = _bridgePool;
        emit ChangedBridgePool(bridgePool);
    }

    function changeBridgePool(address newBridgePool) public onlyOwner {
        bridgePool = newBridgePool;
        emit ChangedBridgePool(bridgePool);
    }

    receive() external payable {
        wrapAndTransfer();
    }

    fallback() external payable {
        wrapAndTransfer();
    }

    function wrapAndTransfer() public payable {
        weth.deposit{ value: address(this).balance }();
        weth.transfer(bridgePool, weth.balanceOf(address(this)));
    }
}
