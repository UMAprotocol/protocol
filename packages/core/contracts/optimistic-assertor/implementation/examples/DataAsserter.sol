// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../interfaces/OptimisticAssertorInterface.sol";
import "../../../common/implementation/AncillaryData.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// This contract allows assertions on any form of data to be made using the UMA Optimistic Assertor and stores the
// proposed value so that it may be retrieved on chain. It only enables one assertion per pair of dataId and asserter
// address. The dataId is intended to be an arbitrary value that uniquely identifies a specific piece of information in
// the consuming contract and is replaceable. Similarly, any data structure can be used to replace the asserted data.
contract DataAsserter {
    using SafeERC20 for IERC20;
    IERC20 public immutable defaultCurrency;
    OptimisticAssertorInterface public immutable oa;
    uint256 public constant assertionLiveness = 7200;
    bytes32 public immutable defaultIdentifier;

    struct DataAssertion {
        uint256 data; // This could be any data type.
        bytes32 oaAssertionId; // The optimistic assertor assertion ID.
    }

    mapping(bytes32 => bytes32) public oaIdsToInternalIds;

    mapping(bytes32 => bool) public assertionsResolved;

    mapping(bytes32 => DataAssertion) public assertionsData;

    event DataAsserted(bytes32 indexed dataId, uint256 data, bytes32 oaAssertionId);

    event DataAssertionResolved(bytes32 indexed dataAssertionId);

    constructor(address _defaultCurrency, address _optimisticAssertor) {
        defaultCurrency = IERC20(_defaultCurrency);
        oa = OptimisticAssertorInterface(_optimisticAssertor);
        defaultIdentifier = oa.defaultIdentifier();
    }

    // Returns a bool of whether the data is available and the data.
    function getData(bytes32 dataId, address asserter) public view returns (bool, uint256) {
        return _getData(getAssertionId(dataId, asserter));
    }

    // Asserts data for a specific dataId on behalf of an asserter address.
    function assertDataFor(
        bytes32 dataId, // This could be any data type.
        uint256 data, // This could be any data type.
        address asserter
    ) public {
        bytes32 dataAssertionId = getAssertionId(dataId, asserter);
        require(assertionsData[dataAssertionId].oaAssertionId == bytes32(0), "Data already asserted");
        uint256 bond = oa.getMinimumBond(address(defaultCurrency));
        defaultCurrency.safeTransferFrom(msg.sender, address(this), bond);
        defaultCurrency.safeApprove(address(oa), bond);
        bytes32 oaAssertionId =
            oa.assertTruthFor(
                abi.encodePacked(
                    "Data asserted for dataId: 0x",
                    AncillaryData.toUtf8Bytes(dataId),
                    " and asserter: 0x",
                    AncillaryData.toUtf8BytesAddress(asserter),
                    " at timestamp: ",
                    AncillaryData.toUtf8BytesUint(block.timestamp),
                    "in the DataAsserter contract at 0x",
                    AncillaryData.toUtf8BytesAddress(address(this)),
                    " is valid."
                ),
                asserter,
                address(this),
                address(0), // No sovereign security manager.
                defaultCurrency,
                bond,
                assertionLiveness,
                defaultIdentifier
            );
        assertionsData[dataAssertionId] = DataAssertion({ data: data, oaAssertionId: oaAssertionId });
        oaIdsToInternalIds[oaAssertionId] = dataAssertionId;
        emit DataAsserted(dataId, data, oaAssertionId);
    }

    // OptimisticAssertor callback.
    function assertionResolved(bytes32 assertionId, bool assertedTruthfully) public {
        require(msg.sender == address(oa));
        // If the assertion was true, then the data assertion is resolved.
        if (assertedTruthfully) {
            assertionsResolved[oaIdsToInternalIds[assertionId]] = true;
            emit DataAssertionResolved(oaIdsToInternalIds[assertionId]);
        } else {
            // Delete the data assertion if it was false so the same asserter can assert it again.
            delete assertionsData[oaIdsToInternalIds[assertionId]];
        }
    }

    // If assertion is disputed, do nothing and wait for resolution.
    // This OptimisticAssertor callback function needs to be defined so the OA doesn't revert when it tries to call it.
    function assertionDisputed(bytes32 assertionId) public {}

    function getAssertionId(bytes32 dataId, address asserter) public pure returns (bytes32) {
        return keccak256(abi.encode(dataId, asserter));
    }

    function _getData(bytes32 dataAssertionId) internal view returns (bool, uint256) {
        if (!assertionsResolved[dataAssertionId]) return (false, 0);
        return (true, assertionsData[dataAssertionId].data);
    }
}
