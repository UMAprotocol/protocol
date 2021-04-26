// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "./BeaconOracle.sol";

/**
 * @title Simple implementation of the OracleInterface that is intended to be deployed on non-Mainnet networks and used
 * to communicate price request data cross-chain with a Source Oracle on Mainnet. An Admin can request prices from
 * this oracle, which might ultimately request a price from a Mainnet Source Oracle and eventually the DVM.
 * @dev Admins capable of making price requests to this contract should be OptimisticOracle contracts. This enables
 * optimistic price resolution on non-Mainnet networks while also providing ultimate security by the DVM on Mainnet.
 */
contract SinkOracle is BeaconOracle {
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override {
        _requestPrice(identifier, time, ancillaryData);
    }
}
