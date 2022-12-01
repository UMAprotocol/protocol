// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../interfaces/OptimisticAsserterInterface.sol";
import "../../../common/implementation/AncillaryData.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// This contract allows assertions on any form of data to be made using the UMA Optimistic Asserter and stores the
// proposed value so that it may be retrieved on chain. The dataId is intended to be an arbitrary value that uniquely
// identifies a specific piece of information in the consuming contract and is replaceable. Similarly, any data
// structure can be used to replace the asserted data.
contract DataAsserter {
    using SafeERC20 for IERC20;
    IERC20 public immutable defaultCurrency;
    OptimisticAsserterInterface public immutable oa;
    uint256 public constant assertionLiveness = 7200;
    bytes32 public immutable defaultIdentifier;

    struct DataAssertion {
        bytes32 dataId; // The dataId that was asserted.
        bytes32 data; // This could be an arbitrary data type.
        address asserter; // The address that made the assertion.
        bool resolved; // Whether the assertion has been resolved.
    }

    mapping(bytes32 => DataAssertion) public assertionsData;

    event DataAsserted(bytes32 indexed dataId, bytes32 data, address indexed asserter, bytes32 assertionId);

    event DataAssertionResolved(bytes32 indexed dataId, bytes32 data, address indexed asserter, bytes32 assertionId);

    constructor(address _defaultCurrency, address _optimisticAsserter) {
        defaultCurrency = IERC20(_defaultCurrency);
        oa = OptimisticAsserterInterface(_optimisticAsserter);
        defaultIdentifier = oa.defaultIdentifier();
    }

    // For a given assertionId, returns a boolean indicating whether the data is accessible and the data itself.
    function getData(bytes32 assertionId) public view returns (bool, bytes32) {
        if (!assertionsData[assertionId].resolved) return (false, 0);
        return (true, assertionsData[assertionId].data);
    }

    // Asserts data for a specific dataId on behalf of an asserter address.
    // Data can be asserted many times with the same combination of arguments, resulting in unique assertionIds. This is
    // because the block.timestamp is included in the claim. The consumer contract must store the returned assertionId
    // identifiers to able to get the information using getData.
    function assertDataFor(
        bytes32 dataId,
        bytes32 data,
        address asserter
    ) public returns (bytes32 assertionId) {
        asserter = asserter == address(0) ? msg.sender : asserter;
        uint256 bond = oa.getMinimumBond(address(defaultCurrency));
        defaultCurrency.safeTransferFrom(msg.sender, address(this), bond);
        defaultCurrency.safeApprove(address(oa), bond);

        // The claim we want to assert is the first argument of assertTruth. It must contain all of the relevant
        // details so that anyone may verify the claim without having to read any further information on chain. As a
        // result, the claim must include both the data id and data, as well as a set of instructions that allow anyone
        // to verify the information in publicly available sources.
        // See the UMIP corresponding to the defaultIdentifier used in the OptimisticAsserter "ASSERT_TRUTH" for more
        // information on how to construct the claim.
        assertionId = oa.assertTruth(
            abi.encodePacked(
                "Data asserted: 0x", // in the example data is type bytes32 so we add the hex prefix 0x.
                AncillaryData.toUtf8Bytes(data),
                " for dataId: 0x",
                AncillaryData.toUtf8Bytes(dataId),
                " and asserter: 0x",
                AncillaryData.toUtf8BytesAddress(asserter),
                " at timestamp: ",
                AncillaryData.toUtf8BytesUint(block.timestamp),
                " in the DataAsserter contract at 0x",
                AncillaryData.toUtf8BytesAddress(address(this)),
                " is valid."
            ),
            asserter,
            address(this),
            address(0), // No sovereign security.
            defaultCurrency,
            bond,
            assertionLiveness,
            defaultIdentifier
        );
        assertionsData[assertionId] = DataAssertion(dataId, data, asserter, false);
        emit DataAsserted(dataId, data, asserter, assertionId);
    }

    // OptimisticAsserter resolve callback.
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) public {
        require(msg.sender == address(oa));
        // If the assertion was true, then the data assertion is resolved.
        if (assertedTruthfully) {
            assertionsData[assertionId].resolved = true;
            DataAssertion memory dataAssertion = assertionsData[assertionId];
            emit DataAssertionResolved(dataAssertion.dataId, dataAssertion.data, dataAssertion.asserter, assertionId);
            // Else delete the data assertion if it was false to save gas.
        } else delete assertionsData[assertionId];
    }

    // If assertion is disputed, do nothing and wait for resolution.
    // This OptimisticAsserter callback function needs to be defined so the OA doesn't revert when it tries to call it.
    function assertionDisputedCallback(bytes32 assertionId) public {}
}
