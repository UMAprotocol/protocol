// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../implementation/AncillaryData.sol";

contract AncillaryDataTest {
    function toUtf8Bytes(address x) external pure returns (bytes memory) {
        return AncillaryData.toUtf8Bytes(x);
    }

    function appendAddressKey(bytes memory currentAncillaryData, bytes memory key, address value) external pure returns (bytes memory) {
        return AncillaryData.appendAddressKey(currentAncillaryData, key, value);
    }
}
