// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import { AncillaryData } from "../common/implementation/AncillaryData.sol";

/**
 * @title Library for compressing ancillary data when bridging DVM price requests to mainnet.
 * @notice This provides internal method for origin chain oracles to compress ancillary data by replacing it with the
 * hash of the original ancillary data and adding additional information to track back the original ancillary data on
 * mainnet.
 */
library AncillaryDataCompression {
    /**
     * @notice Compresses ancillary data by providing sufficient information to track back the original ancillary data
     * on mainnet.
     * @dev The compression replaces original ancillary data with its hash and adds address of origin chain oracle and
     * block number so that its more efficient to fetch original ancillary data from PriceRequestBridged event on origin
     * chain indexed by parentRequestId. This parentRequestId can be reconstructed by taking keccak256 hash of ABI
     * encoded price identifier, time and ancillary data.
     * @param ancillaryData original ancillary data to be processed.
     * @param requester address of the requester who initiated the price request.
     * @param requestBlockNumber block number when the price request was initiated.
     * @return compressed ancillary data.
     */
    function compress(
        bytes memory ancillaryData,
        address requester,
        uint256 requestBlockNumber
    ) internal view returns (bytes memory) {
        return
            AncillaryData.appendKeyValueUint(
                AncillaryData.appendKeyValueAddress(
                    AncillaryData.appendKeyValueAddress(
                        AncillaryData.appendKeyValueUint(
                            AncillaryData.appendKeyValueBytes32("", "ancillaryDataHash", keccak256(ancillaryData)),
                            "childBlockNumber",
                            requestBlockNumber
                        ),
                        "childOracle",
                        address(this)
                    ),
                    "childRequester",
                    requester
                ),
                "childChainId",
                block.chainid
            );
    }
}
