// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../interfaces/StoreInterface.sol";
import "../../interfaces/OracleAncillaryInterface.sol";
import "../../interfaces/FinderInterface.sol";
import "../../interfaces/IdentifierWhitelistInterface.sol";
import "../../interfaces/OptimisticOracleV2Interface.sol";

import "../../../common/implementation/AncillaryData.sol";
import "../../../common/implementation/AddressWhitelist.sol";
import "../Constants.sol";

contract OptimisticArbitrator {
    using SafeERC20 for IERC20;

    struct Request {
        address proposer; // Address of the proposer.
        address disputer; // Address of the disputer.
        IERC20 currency; // ERC20 token used to pay rewards and fees.
        bool settled; // True if the request is settled.
        int256 proposedPrice; // Price that the proposer submitted.
        uint256 reward; // Amount of the currency to pay to the proposer on settlement.
        uint256 finalFee; // Final fee to pay to the Store upon request to the DVM.
        uint256 bond; // Bond that the proposer and disputer must pay on top of the final fee.
        uint64 customLiveness; // Custom liveness value set by the requester.
        uint64 expirationTime; // Time at which the request auto-settles without a dispute.
    }

    FinderInterface public finder;

    uint256 public constant OO_ANCILLARY_DATA_LIMIT = 8139; // 8192 - 53

    constructor(address _finderAddress, address _timerAddress) {
        finder = FinderInterface(_finderAddress);
    }

    mapping(bytes32 => Request) public requests;

    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        IERC20 currency,
        uint256 reward,
        uint256 bond,
        uint64 customLiveness
    ) public {
        bytes32 requestId = _getId(msg.sender, identifier, timestamp, ancillaryData);
        if (requests[requestId].proposer != address(0)) return; // If the address is already initialized return early.
        require(_getIdentifierWhitelist().isIdentifierSupported(identifier), "Unsupported identifier");
        require(_getCollateralWhitelist().isOnWhitelist(address(currency)), "Unsupported currency");
        require(timestamp <= getCurrentTime(), "Timestamp in future");
        require(ancillaryData.length <= OO_ANCILLARY_DATA_LIMIT, "Ancillary Data too long");

        requests[requestId] = Request({
            proposer: address(0),
            disputer: address(0),
            currency: currency,
            settled: false,
            proposedPrice: 0,
            reward: reward,
            finalFee: _getStore().computeFinalFee(address(currency)).rawValue,
            bond: bond,
            customLiveness: customLiveness,
            expirationTime: 0
        });

        if (reward > 0) currency.safeTransferFrom(msg.sender, address(this), reward);
    }

    function proposePrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice
    ) public {
        Request storage request = requests[_getId(msg.sender, identifier, timestamp, ancillaryData)];
        require(address(request.currency) != address(0), "Price not requested");
        require(request.proposer == address(0), "Current proposal in liveness");

        request.proposer = msg.sender;
        request.proposedPrice = proposedPrice;
        request.expirationTime = uint64(getCurrentTime()) + request.customLiveness;

        request.currency.safeTransferFrom(msg.sender, address(this), request.bond + request.finalFee);
    }

    function disputePrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) public {
        Request storage request = requests[_getId(msg.sender, identifier, timestamp, ancillaryData)];
        require(request.proposer != address(0), "No proposed price to dispute");
        require(request.disputer == address(0), "Proposal already disputed");
        require(uint64(getCurrentTime()) < request.expirationTime, "Proposal past liveness");

        request.disputer = msg.sender;

        request.currency.safeTransferFrom(msg.sender, address(this), request.bond + request.finalFee);

        OptimisticOracleV2Interface oo = _getOptimisticOracle();
        oo.requestPrice(identifier, timestamp, ancillaryData, request.currency, request.reward);
        oo.proposePriceFor(
            request.proposer,
            address(this),
            identifier,
            timestamp,
            ancillaryData,
            request.proposedPrice
        );
        oo.disputePriceFor(msg.sender, address(this), identifier, timestamp, ancillaryData);

        delete requests[_getId(msg.sender, identifier, timestamp, ancillaryData)];
    }

    function settleAndGetPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) public returns (int256) {
        Request storage request = requests[_getId(msg.sender, identifier, timestamp, ancillaryData)];
        require(address(request.currency) != address(0), "Price not requested");
        require(request.proposer != address(0), "No proposed price to settle");
        require(uint64(getCurrentTime()) > request.expirationTime, "Proposal not passed liveness");
        require(request.disputer == address(0), "Proposal disputed, cant settle");

        request.settled = true;

        request.currency.safeTransferFrom(
            address(this),
            request.proposer,
            request.bond + request.finalFee + request.reward
        );

        return request.proposedPrice;
    }

    function getPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) public returns (int256) {
        Request storage request = requests[_getId(msg.sender, identifier, timestamp, ancillaryData)];
        require(request.settled == true, "Request not settled");
        return request.proposedPrice;
    }

    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    function _getId(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(requester, identifier, timestamp, ancillaryData));
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracleV2Interface) {
        return OptimisticOracleV2Interface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV2));
    }
}
