// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../implementation/AncillaryData.sol";

contract AncillaryDataTest {
    function toUtf8BytesAddress(address x) external pure returns (bytes memory) {
        return AncillaryData.toUtf8BytesAddress(x);
    }

    function toUtf8BytesUint(uint256 v) external pure returns (bytes memory) {
        return AncillaryData.toUtf8BytesUint(v);
    }

    function appendKeyValueAddress(
        bytes memory currentAncillaryData,
        bytes memory key,
        address value
    ) external pure returns (bytes memory) {
        return AncillaryData.appendKeyValueAddress(currentAncillaryData, key, value);
    }

    function appendKeyValueBytes32(
        bytes memory currentAncillaryData,
        bytes memory key,
        bytes32 value
    ) external pure returns (bytes memory) {
        return AncillaryData.appendKeyValueBytes32(currentAncillaryData, key, value);
    }

    function appendKeyValueUint(
        bytes memory currentAncillaryData,
        bytes memory key,
        uint256 value
    ) external pure returns (bytes memory) {
        return AncillaryData.appendKeyValueUint(currentAncillaryData, key, value);
    }

    function constructPrefix(bytes memory currentAncillaryData, bytes memory key) external pure returns (bytes memory) {
        return AncillaryData.constructPrefix(currentAncillaryData, key);
    }
}
