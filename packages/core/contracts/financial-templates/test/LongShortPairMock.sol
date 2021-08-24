// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

contract LongShortPairMock {
    uint256 public expirationTimestamp;
    uint256 public collateralPerPair;

    constructor(uint256 _expirationTimestamp, uint256 _collateralPerPair) {
        expirationTimestamp = _expirationTimestamp;
        collateralPerPair = _collateralPerPair;
    }
}
