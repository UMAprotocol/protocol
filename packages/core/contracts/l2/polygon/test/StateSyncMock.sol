// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract StateSyncMock{

    uint256 public counter;

    event StateSynced(
        uint256 indexed id,
        address indexed contractAddress,
        bytes data
    );

    function syncState(address receiver, bytes calldata data)
        external
    {
        counter = counter + 1;
        emit StateSynced(counter, receiver, data);
    }
}