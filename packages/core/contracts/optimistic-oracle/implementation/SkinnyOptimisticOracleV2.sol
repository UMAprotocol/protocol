// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "../../data-verification-mechanism/interfaces/StoreInterface.sol";
import "../../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../interfaces/OptimisticOracleInterface.sol";
import "../interfaces/SkinnyOptimisticOracleV2Interface.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../../data-verification-mechanism/implementation/Constants.sol";

import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/AddressWhitelist.sol";

/**
 * @title Optimistic Requester.
 * @notice Optional interface that requesters can implement to receive callbacks.
 * @dev This contract does _not_ work with ERC777 collateral currencies or any others that call into the receiver on
 * transfer(). Using an ERC777 token would allow a user to maliciously grief other participants (while also losing
 * money themselves).
 */
interface OptimisticRequesterV2 {
    /**
     * @notice Callback for proposals.
     * @param identifier price identifier being requested.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request request params after proposal.
     */
    function priceProposed(
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        SkinnyOptimisticOracleV2Interface.Request memory request
    ) external;

    /**
     * @notice Callback for disputes.
     * @param identifier price identifier being requested.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request request params after dispute.
     */
    function priceDisputed(
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        SkinnyOptimisticOracleV2Interface.Request memory request
    ) external;

    /**
     * @notice Callback for settlement.
     * @param identifier price identifier being requested.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request request params after settlement.
     */
    function priceSettled(
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        SkinnyOptimisticOracleV2Interface.Request memory request
    ) external;
}

/**
 * @title Optimistic Oracle with a different interface and fewer features that emphasizes gas cost reductions.
 * @notice Pre-DVM escalation contract that allows faster settlement.
 */
contract SkinnyOptimisticOracleV2 is SkinnyOptimisticOracleV2Interface, Testable, Lockable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address;

    event RequestPrice(
        address indexed requester,
        bytes32 indexed identifier,
        uint32 timestamp,
        bytes ancillaryData,
        Request request
    );
    event ProposePrice(
        address indexed requester,
        bytes32 indexed identifier,
        uint32 timestamp,
        bytes ancillaryData,
        Request request
    );
    event DisputePrice(
        address indexed requester,
        bytes32 indexed identifier,
        uint32 timestamp,
        bytes ancillaryData,
        Request request
    );
    event Settle(
        address indexed requester,
        bytes32 indexed identifier,
        uint32 timestamp,
        bytes ancillaryData,
        Request request
    );

    // Maps hash of unique request params {identifier, timestamp, ancillary data} to customizable variables such as
    // reward and bond amounts.
    mapping(bytes32 => bytes32) public requests;

    // Finder to provide addresses for DVM contracts.
    FinderInterface public finder;

    // Default liveness value for all price requests.
    uint256 public defaultLiveness;

    /**
     * @notice Constructor.
     * @param _liveness default liveness applied to each price request.
     * @param _finderAddress finder to use to get addresses of DVM contracts.
     * @param _timerAddress address of the timer contract. Should be 0x0 in prod.
     */
    constructor(
        uint256 _liveness,
        address _finderAddress,
        address _timerAddress
    ) Testable(_timerAddress) {
        finder = FinderInterface(_finderAddress);
        _validateLiveness(_liveness);
        defaultLiveness = _liveness;
    }

    /**
     * @notice Requests a new price.
     * @param identifier price identifier being requested.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data representing additional args being passed with the price request.
     * @param currency ERC20 token used for payment of rewards and fees. Must be approved for use with the DVM.
     * @param reward reward offered to a successful proposer. Will be pulled from the caller. Note: this can be 0,
     *               which could make sense if the contract requests and proposes the value in the same call or
     *               provides its own reward system.
     * @param requestSettings settings for the request.
     * @return totalBond default bond + final fee that the proposer and disputer will be required to pay.
     */
    function requestPrice(
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        IERC20 currency,
        uint256 reward,
        RequestSettings memory requestSettings
    ) external override nonReentrant() returns (uint256 totalBond) {
        bytes32 requestId = _getId(msg.sender, identifier, timestamp, ancillaryData);
        require(requests[requestId] == bytes32(0), "Request already initialized");
        require(_getIdentifierWhitelist().isIdentifierSupported(identifier), "Unsupported identifier");
        require(_getCollateralWhitelist().isOnWhitelist(address(currency)), "Unsupported currency");
        require(timestamp <= getCurrentTime(), "Timestamp in future");
        require(
            _stampAncillaryData(ancillaryData, msg.sender).length <= ancillaryBytesLimit,
            "Ancillary Data too long"
        );
        uint256 finalFee = _getStore().computeFinalFee(address(currency)).rawValue;

        // Associate new request with ID
        Request memory request;
        request.currency = currency;
        request.reward = reward;
        request.finalFee = finalFee;
        request.requestSettings = requestSettings;
        request.requestSettings.bond = requestSettings.bond != 0 ? requestSettings.bond : finalFee;
        _storeRequestHash(requestId, request);

        if (reward > 0) currency.safeTransferFrom(msg.sender, address(this), reward);

        emit RequestPrice(msg.sender, identifier, timestamp, ancillaryData, request);

        return request.requestSettings.bond.add(finalFee);
    }

    /**
     * @notice Proposes a price value on another address' behalf. Note: this address will receive any rewards that come
     * from this proposal. However, any bonds are pulled from the caller.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request price request parameters whose hash must match the request that the caller wants to
     * propose a price for.
     * @param proposer address to set as the proposer.
     * @param proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function proposePriceFor(
        address requester,
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        Request memory request,
        address proposer,
        int256 proposedPrice
    ) public override nonReentrant() returns (uint256 totalBond) {
        require(proposer != address(0), "Proposer address must be non 0");
        require(
            _getState(requester, identifier, timestamp, ancillaryData, request) ==
                OptimisticOracleInterface.State.Requested,
            "Must be requested"
        );
        bytes32 requestId = _getId(requester, identifier, timestamp, ancillaryData);
        _validateRequestHash(requestId, request);

        // Associate newly proposed request params with ID
        Request memory proposedRequest =
            Request({
                proposer: proposer, // Modified
                disputer: request.disputer,
                currency: request.currency,
                settled: request.settled,
                proposedPrice: proposedPrice, // Modified
                resolvedPrice: request.resolvedPrice,
                expirationTime: getCurrentTime().add(
                    request.requestSettings.customLiveness != 0
                        ? request.requestSettings.customLiveness
                        : defaultLiveness
                ), // Modified
                reward: request.reward,
                finalFee: request.finalFee,
                requestSettings: request.requestSettings
            });
        _storeRequestHash(requestId, proposedRequest);

        totalBond = request.requestSettings.bond.add(request.finalFee);
        if (totalBond > 0) request.currency.safeTransferFrom(msg.sender, address(this), totalBond);

        emit ProposePrice(requester, identifier, timestamp, ancillaryData, proposedRequest);

        // Callback.
        if (address(requester).isContract() && request.requestSettings.callbackOnPriceProposed)
            OptimisticRequesterV2(requester).priceProposed(identifier, timestamp, ancillaryData, proposedRequest);
    }

    /**
     * @notice Proposes a price value where caller is the proposer.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request price request parameters whose hash must match the request that the caller wants to
     * propose a price for.
     * @param proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function proposePrice(
        address requester,
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        Request memory request,
        int256 proposedPrice
    ) external override returns (uint256 totalBond) {
        // Note: re-entrancy guard is done in the inner call.
        return proposePriceFor(requester, identifier, timestamp, ancillaryData, request, msg.sender, proposedPrice);
    }

    /**
     * @notice Combines logic of requestPrice and proposePrice while taking advantage of gas savings from not having to
     * overwrite Request params that a normal requestPrice() => proposePrice() flow would entail. Note: The proposer
     * will receive any rewards that come from this proposal. However, any bonds are pulled from the caller.
     * @dev The caller is the requester, but the proposer can be customized.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param currency ERC20 token used for payment of rewards and fees. Must be approved for use with the DVM.
     * @param reward reward offered to a successful proposer. Will be pulled from the caller. Note: this can be 0,
     *               which could make sense if the contract requests and proposes the value in the same call or
     *               provides its own reward system.
     * @param requestSettings settings for the request.
     * @param proposer address to set as the proposer.
     * @param proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function requestAndProposePriceFor(
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        IERC20 currency,
        uint256 reward,
        RequestSettings memory requestSettings,
        address proposer,
        int256 proposedPrice
    ) external override nonReentrant() returns (uint256 totalBond) {
        bytes32 requestId = _getId(msg.sender, identifier, timestamp, ancillaryData);
        require(requests[requestId] == bytes32(0), "Request already initialized");
        require(proposer != address(0), "proposer address must be non 0");
        require(_getIdentifierWhitelist().isIdentifierSupported(identifier), "Unsupported identifier");
        require(_getCollateralWhitelist().isOnWhitelist(address(currency)), "Unsupported currency");
        require(timestamp <= getCurrentTime(), "Timestamp in future");
        require(
            _stampAncillaryData(ancillaryData, msg.sender).length <= ancillaryBytesLimit,
            "Ancillary Data too long"
        );
        uint256 finalFee = _getStore().computeFinalFee(address(currency)).rawValue;

        // Associate new request with ID
        Request memory request;
        request.currency = currency;
        request.reward = reward;
        request.finalFee = finalFee;
        request.requestSettings = requestSettings;
        request.requestSettings.bond = requestSettings.bond != 0 ? requestSettings.bond : finalFee;
        request.proposer = proposer;
        request.proposedPrice = proposedPrice;
        request.expirationTime = getCurrentTime().add(
            requestSettings.customLiveness != 0 ? requestSettings.customLiveness : defaultLiveness
        );
        _storeRequestHash(requestId, request);

        // Pull reward from requester, who is the caller.
        if (reward > 0) currency.safeTransferFrom(msg.sender, address(this), reward);
        // Pull proposal bond from caller.
        totalBond = request.requestSettings.bond.add(request.finalFee);
        if (totalBond > 0) currency.safeTransferFrom(msg.sender, address(this), totalBond);

        emit RequestPrice(msg.sender, identifier, timestamp, ancillaryData, request);
        emit ProposePrice(msg.sender, identifier, timestamp, ancillaryData, request);

        // Callback.
        if (address(msg.sender).isContract() && requestSettings.callbackOnPriceProposed)
            OptimisticRequesterV2(msg.sender).priceProposed(identifier, timestamp, ancillaryData, request);
    }

    /**
     * @notice Disputes a price request with an active proposal on another address' behalf. Note: this address will
     * receive any rewards that come from this dispute. However, any bonds are pulled from the caller.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request price request parameters whose hash must match the request that the caller wants to
     *              dispute.
     * @param disputer address to set as the disputer.
     * @param requester sender of the initial price request.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the disputer once settled if the dispute was valid (the proposal was incorrect).
     */
    function disputePriceFor(
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        Request memory request,
        address disputer,
        address requester
    ) public override nonReentrant() returns (uint256 totalBond) {
        require(disputer != address(0), "disputer address must be non 0");
        require(
            _getState(requester, identifier, timestamp, ancillaryData, request) ==
                OptimisticOracleInterface.State.Proposed,
            "Must be proposed"
        );
        bytes32 requestId = _getId(requester, identifier, timestamp, ancillaryData);
        _validateRequestHash(requestId, request);

        // Associate newly disputed request params with ID
        Request memory disputedRequest =
            Request({
                proposer: request.proposer,
                disputer: disputer, // Modified
                currency: request.currency,
                settled: request.settled,
                proposedPrice: request.proposedPrice,
                resolvedPrice: request.resolvedPrice,
                expirationTime: request.expirationTime,
                reward: request.reward,
                finalFee: request.finalFee,
                requestSettings: request.requestSettings
            });
        _storeRequestHash(requestId, disputedRequest);

        totalBond = request.requestSettings.bond.add(request.finalFee);
        if (totalBond > 0) request.currency.safeTransferFrom(msg.sender, address(this), totalBond);

        StoreInterface store = _getStore();

        // Avoids stack too deep compilation error.
        {
            // Along with the final fee, "burn" part of the loser's bond to ensure that a larger bond always makes it
            // proportionally more expensive to delay the resolution even if the proposer and disputer are the same
            // party.
            uint256 burnedBond = _computeBurnedBond(disputedRequest);

            // The total fee is the burned bond and the final fee added together.
            uint256 totalFee = request.finalFee.add(burnedBond);

            if (totalFee > 0) {
                request.currency.safeIncreaseAllowance(address(store), totalFee);
                _getStore().payOracleFeesErc20(address(request.currency), FixedPoint.Unsigned(totalFee));
            }
        }

        _getOracle().requestPrice(identifier, timestamp, _stampAncillaryData(ancillaryData, requester));

        emit DisputePrice(requester, identifier, timestamp, ancillaryData, disputedRequest);

        // Callback.
        if (address(requester).isContract() && request.requestSettings.callbackOnPriceDisputed)
            OptimisticRequesterV2(requester).priceDisputed(identifier, timestamp, ancillaryData, disputedRequest);
    }

    /**
     * @notice Disputes a price request with an active proposal where caller is the disputer.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request price request parameters whose hash must match the request that the caller wants to
     *             dispute.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the disputer once settled if the dispute was valid (the proposal was incorrect).
     */
    function disputePrice(
        address requester,
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        Request memory request
    ) external override returns (uint256 totalBond) {
        // Note: re-entrancy guard is done in the inner call.
        return disputePriceFor(identifier, timestamp, ancillaryData, request, msg.sender, requester);
    }

    /**
     * @notice Attempts to settle an outstanding price request. Will revert if it isn't settleable.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request price request parameters whose hash must match the request that the caller wants to
     *              settle.
     * @return payout the amount that the "winner" (proposer or disputer) receives on settlement. This amount includes
     * the returned bonds as well as additional rewards.
     * @return resolvedPrice the price that the request settled to.
     */
    function settle(
        address requester,
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        Request memory request
    ) external override nonReentrant() returns (uint256 payout, int256 resolvedPrice) {
        return _settle(requester, identifier, timestamp, ancillaryData, request);
    }

    /**
     * @notice Computes the current state of a price request. See the State enum for more details.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request price request parameters.
     * @return the State.
     */
    function getState(
        address requester,
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        Request memory request
    ) external override nonReentrant() returns (OptimisticOracleInterface.State) {
        return _getState(requester, identifier, timestamp, ancillaryData, request);
    }

    /**
     * @notice Checks if a given request has resolved, expired or been settled (i.e the optimistic oracle has a price).
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param request price request parameters. The hash of these parameters must match with the request hash that is
     * associated with the price request unique ID {requester, identifier, timestamp, ancillaryData}, or this method
     * will revert.
     * @return boolean indicating true if price exists and false if not.
     */
    function hasPrice(
        address requester,
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        Request memory request
    ) public override nonReentrant() returns (bool) {
        bytes32 requestId = _getId(requester, identifier, timestamp, ancillaryData);
        _validateRequestHash(requestId, request);
        OptimisticOracleInterface.State state = _getState(requester, identifier, timestamp, ancillaryData, request);
        return
            state == OptimisticOracleInterface.State.Settled ||
            state == OptimisticOracleInterface.State.Resolved ||
            state == OptimisticOracleInterface.State.Expired;
    }

    /**
     * @notice Generates stamped ancillary data in the format that it would be used in the case of a price dispute.
     * @param ancillaryData ancillary data of the price being requested.
     * @param requester sender of the initial price request.
     * @return the stamped ancillary bytes.
     */
    function stampAncillaryData(bytes memory ancillaryData, address requester)
        public
        pure
        override
        returns (bytes memory)
    {
        return _stampAncillaryData(ancillaryData, requester);
    }

    /****************************************
     *    PRIVATE AND INTERNAL FUNCTIONS    *
     ****************************************/
    // Returns hash of unique request identifiers. This contract maps request ID hashes to hashes of the request's
    // parameters.
    function _getId(
        address requester,
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(requester, identifier, timestamp, ancillaryData));
    }

    // Returns hash of request parameters. These are mapped to the unique request ID to track a request's lifecycle.
    function _getRequestHash(Request memory request) private pure returns (bytes32) {
        return keccak256(abi.encode(request));
    }

    // Resolves a price request that has expired or been disputed and a price is available from the DVM. This will
    // revert if the unique request ID does not match the hashed request parameters. This also marks the request
    // as settled, therefore this method can only be triggered once per eligible request.
    function _settle(
        address requester,
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        Request memory request
    ) private returns (uint256 payout, int256 resolvedPrice) {
        bytes32 requestId = _getId(requester, identifier, timestamp, ancillaryData);
        _validateRequestHash(requestId, request);

        // Associate settled request params with ID.
        Request memory settledRequest =
            Request({
                proposer: request.proposer,
                disputer: request.disputer,
                currency: request.currency,
                settled: true, // Modified
                proposedPrice: request.proposedPrice,
                resolvedPrice: request.resolvedPrice,
                expirationTime: request.expirationTime,
                reward: request.reward,
                finalFee: request.finalFee,
                requestSettings: request.requestSettings
            });

        OptimisticOracleInterface.State state = _getState(requester, identifier, timestamp, ancillaryData, request);
        if (state == OptimisticOracleInterface.State.Expired) {
            // In the expiry case, just pay back the proposer's bond and final fee along with the reward.
            resolvedPrice = request.proposedPrice;
            settledRequest.resolvedPrice = resolvedPrice;
            payout = request.requestSettings.bond.add(request.finalFee).add(request.reward);
            request.currency.safeTransfer(request.proposer, payout);
        } else if (state == OptimisticOracleInterface.State.Resolved) {
            // In the Resolved case, pay either the disputer or the proposer the entire payout (+ bond and reward).
            resolvedPrice = _getOracle().getPrice(identifier, timestamp, _stampAncillaryData(ancillaryData, requester));
            settledRequest.resolvedPrice = resolvedPrice;
            bool disputeSuccess = settledRequest.resolvedPrice != request.proposedPrice;

            // Winner gets:
            // - Their bond back.
            // - The unburned portion of the loser's bond: proposal bond (not including final fee) - burned bond.
            // - Their final fee back.
            // - The request reward (if not already refunded -- if refunded, it will be set to 0).
            payout = request
                .requestSettings
                .bond
                .add(request.requestSettings.bond.sub(_computeBurnedBond(settledRequest)))
                .add(request.finalFee)
                .add(request.reward);
            request.currency.safeTransfer(disputeSuccess ? request.disputer : request.proposer, payout);
        } else {
            revert("Already settled or not settleable");
        }

        _storeRequestHash(requestId, settledRequest);
        emit Settle(requester, identifier, timestamp, ancillaryData, settledRequest);

        // Callback.
        if (address(requester).isContract() && request.requestSettings.callbackOnPriceSettled)
            OptimisticRequesterV2(requester).priceSettled(identifier, timestamp, ancillaryData, settledRequest);
    }

    function _computeBurnedBond(Request memory request) private pure returns (uint256) {
        // burnedBond = floor(bond / 2)
        return request.requestSettings.bond.div(2);
    }

    function _validateLiveness(uint256 liveness) private pure {
        require(liveness < 5200 weeks, "Liveness too large");
        require(liveness > 0, "Liveness cannot be 0");
    }

    function _validateRequestHash(bytes32 requestId, Request memory request) private view {
        require(
            requests[requestId] == _getRequestHash(request),
            "Hashed request params do not match existing request hash"
        );
    }

    function _storeRequestHash(bytes32 requestId, Request memory request) internal {
        requests[requestId] = _getRequestHash(request);
    }

    function _getState(
        address requester,
        bytes32 identifier,
        uint32 timestamp,
        bytes memory ancillaryData,
        Request memory request
    ) internal view returns (OptimisticOracleInterface.State) {
        // Note: This function does not check whether all of the _request parameter values are correct. For example,
        // the request.reward could be any value and it would not impact this function's return value. Therefore, it
        // is the caller's responsibility to check that _request matches with the expected ID corresponding to
        // {requester, identifier, timestamp, ancillaryData} via _validateRequestHash().
        if (address(request.currency) == address(0)) return OptimisticOracleInterface.State.Invalid;

        if (request.proposer == address(0)) return OptimisticOracleInterface.State.Requested;

        if (request.settled) return OptimisticOracleInterface.State.Settled;

        if (request.disputer == address(0))
            return
                request.expirationTime <= getCurrentTime()
                    ? OptimisticOracleInterface.State.Expired
                    : OptimisticOracleInterface.State.Proposed;

        return
            _getOracle().hasPrice(identifier, timestamp, _stampAncillaryData(ancillaryData, requester))
                ? OptimisticOracleInterface.State.Resolved
                : OptimisticOracleInterface.State.Disputed;
    }

    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
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

    /**
     * @dev We don't handle specifically the case where `ancillaryData` is not already readily translateable in utf8.
     * For those cases, we assume that the client will be able to strip out the utf8-translateable part of the
     * ancillary data that this contract stamps.
     */
    function _stampAncillaryData(bytes memory ancillaryData, address requester) internal pure returns (bytes memory) {
        // Since this contract will be the one to formally submit DVM price requests, its useful for voters to know who
        // the original requester was.
        return AncillaryData.appendKeyValueAddress(ancillaryData, "ooRequester", requester);
    }
}

/**
 * @notice This is the SkinnyOptimisticOracle contract that should be deployed on live networks. It is exactly the same
 * as the regular SkinnyOptimisticOracle contract, but it overrides getCurrentTime to make the call a simply return
 * block.timestamp with no branching or storage queries.
 */
contract SkinnyOptimisticOracleV2Prod is SkinnyOptimisticOracleV2 {
    constructor(
        uint256 _liveness,
        address _finderAddress,
        address _timerAddress
    ) SkinnyOptimisticOracleV2(_liveness, _finderAddress, _timerAddress) {}

    function getCurrentTime() public view virtual override returns (uint256) {
        return block.timestamp;
    }
}
