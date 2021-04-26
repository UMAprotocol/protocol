// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "./BeaconOracle.sol";
import "../../interfaces/FinderInterface.sol";
import "../Constants.sol";

/**
 * @title Simple implementation of the OracleInterface that is intended to be deployed on Mainnet and used
 * to communicate price request data cross-chain with Sink Oracles on non-Mainnet networks. An Admin can publish
 * prices to this oracle. An off-chain relayer can subsequently see when prices are published and signal to publish
 * those prices to any non-Mainnet Sink Oracles.
 * @dev This contract should be able to make price requests to the DVM, and the Admin capable of making and publishing
 * price reqests should be an off-chain relayer capable of detecting signals from the non-Mainnet Sink Oracles.
 */
contract SourceOracle is BeaconOracle {
    // Finder to provide addresses for DVM contracts.
    FinderInterface public finder;

    /**
     * @notice Constructor.
     * @param _finderAddress finder to use to get addresses of DVM contracts.
     */
    constructor(address _finderAddress) public {
        finder = FinderInterface(_finderAddress);
    }

    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override {
        _requestPrice(identifier, time, ancillaryData);
        _getOracle().requestPrice(identifier, time, ancillaryData);
    }

    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }
}
