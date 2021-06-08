// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @title Library for encoding and decoding ancillary data for DVM price requests.
 * @notice  We assume that on-chain ancillary data can be formatted directly from bytes to utf8 encoding via
 * web3.utils.hexToUtf8, and that clients will parse the utf8-encoded ancillary data as a comma-delimitted key-value
 * dictionary. Therefore, this libraries provides internal methods that aid appending to ancillary data from Solidity
 * smart contracts. More details on UMA's ancillary data guidelines below:
 * https://docs.google.com/document/d/1zhKKjgY1BupBGPPrY_WOJvui0B6DMcd-xDR8-9-SPDw/edit
 */
library AncillaryData {
    /**
     * @notice Returns utf8-encoded address that can be read via web3.utils.hexToUtf8.
     * Source: https://ethereum.stackexchange.com/questions/8346/convert-address-to-string/8447#8447
     * @dev Will return address in all lower case characters and without the leading 0x.
     * @param x address to encode.
     * @return utf8 encoded address bytes.
     */
    function toUtf8Bytes(address x) internal pure returns (bytes memory) {
        bytes memory s = new bytes(40);
        for (uint256 i = 0; i < 20; i++) {
            bytes1 b = bytes1(uint8(uint256(uint160(x)) / (2**(8 * (19 - i)))));
            bytes1 hi = bytes1(uint8(b) / 16);
            bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
            s[2 * i] = char(hi);
            s[2 * i + 1] = char(lo);
        }
        return s;
    }

    function char(bytes1 b) internal pure returns (bytes1 c) {
        if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
        else return bytes1(uint8(b) + 0x57);
    }
}
