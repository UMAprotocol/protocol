// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import { AncillaryData } from "../common/implementation/AncillaryData.sol";

/**
 * @title Library for modifying ancillary data when bridging DVM price requests to mainnet.
 * @notice This provides internal methods for origin chain oracles to stamp additional metadata to ancillary data or
 * compress it when it exceeds a certain size threshold.
 */
library AncillaryDataBridging {
    // Compressing the ancillary data adds additional key-value pairs compared to the stamping method so that its easier
    // to track back the original request when voting on mainnet. Actual threshold when compression would produce
    // shorter data varies depending on the number of decimal digits of chainId and block number, but 256 bytes has a
    // safe margin ensuring that the compression will not be longer than stamping.
    uint256 public constant compressAncillaryBytesThreshold = 256;

    /**
     * @notice Compresses longer ancillary data by providing sufficient information to track back the original ancillary
     * data on mainnet. In case of shorter ancillary data, it simply returns the stamped ancillary data as is.
     * @dev This requires caller to pass the stamped ancillary data as it already might have it precomputed, thus
     * avoiding repeated computation here.
     * @param ancillaryData original ancillary data to be processed.
     * @param stampedAncillaryData ancillary data that should have been stamped with requester's address and child chain ID.
     * @param requester address of the requester who initiated the price request.
     * @param requestBlockNumber block number when the price request was initiated.
     * @return compressed ancillary data if it exceeds the threshold, otherwise the stamped ancillary data as is.
     */
    function stampOrCompressAncillaryData(
        bytes memory ancillaryData,
        bytes memory stampedAncillaryData,
        address requester,
        uint256 requestBlockNumber
    ) internal view returns (bytes memory) {
        if (ancillaryData.length <= compressAncillaryBytesThreshold) return stampedAncillaryData;

        return compressAncillaryData(ancillaryData, requester, requestBlockNumber);
    }

    /**
     * @notice Compresses ancillary data by providing sufficient information to track back the original ancillary data
     * on mainnet.
     * @dev Compared to the simple stamping method, the compression replaces original ancillary data with its hash and
     * adds address of origin chain oracle and block number so that its more efficient to fetch original ancillary data
     * from PriceRequestBridged event on origin chain indexed by parentRequestId. This parentRequestId can be
     * reconstructed by taking keccak256 hash of ABI encoded price identifier, time and ancillary data.
     * @param ancillaryData original ancillary data to be processed.
     * @param requester address of the requester who initiated the price request.
     * @param requestBlockNumber block number when the price request was initiated.
     * @return compressed ancillary data.
     */
    function compressAncillaryData(
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

    /**
     * @notice Stamps ancillary data with child chain ID and requester's address.
     * @dev We don't handle specifically the case where `ancillaryData` is not already readily translatable in utf8.
     * For those cases, we assume that the client will be able to strip out the utf8-translatable part of the
     * ancillary data that this contract stamps.
     * @param ancillaryData original ancillary data to be processed.
     * @param requester address of the requester who initiated the price request.
     * @return stamped ancillary data.
     */
    function stampAncillaryData(bytes memory ancillaryData, address requester) internal view returns (bytes memory) {
        // This contract should stamp the child network's ID and requester's address so that voters on the parent
        // network can deterministically track unique price requests back to this contract.
        return
            AncillaryData.appendKeyValueUint(
                AncillaryData.appendKeyValueAddress(ancillaryData, "childRequester", requester),
                "childChainId",
                block.chainid
            );
    }
}
