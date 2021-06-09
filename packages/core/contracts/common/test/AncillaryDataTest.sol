// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../implementation/AncillaryData.sol";

contract AncillaryDataTest {
    function toUtf8Bytes(address x) external pure returns (bytes memory) {
        return AncillaryData.toUtf8Bytes(x);
    }

    function toUtf8String(uint256 v) external pure returns (string memory) {
        return AncillaryData.toUtf8String(v);
    }

    function appendAddressKey(
        bytes memory currentAncillaryData,
        bytes memory key,
        address value
    ) external pure returns (bytes memory) {
        return AncillaryData.appendAddressKey(currentAncillaryData, key, value);
    }

    function appendChainId(bytes memory currentAncillaryData) external view returns (bytes memory) {
        return AncillaryData.appendChainId(currentAncillaryData);
    }
}
