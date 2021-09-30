// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "../interfaces/StoreInterface.sol";
import "../interfaces/OracleAncillaryInterface.sol";
import "../interfaces/OptimisticOracleInterface.sol";
import "../interfaces/SkinnyOptimisticOracleInterface.sol";
import "../interfaces/FinderInterface.sol";
import "../interfaces/IdentifierWhitelistInterface.sol";
import "./Constants.sol";

import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/AddressWhitelist.sol";

/**
 * @title Optimistic Oracle with a different interface and fewer features that emphasizes gas cost reductions.
 * @notice Pre-DVM escalation contract that allows faster settlement.
 */
contract SkinnyOptimisticOracle is SkinnyOptimisticOracleInterface, Testable, Lockable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address;

    event RequestPrice(
        address indexed requester,
        bytes32 indexed identifier,
        uint256 timestamp,
        bytes ancillaryData,
        Request request
    );
    event ProposePrice(
        address indexed requester,
        bytes32 indexed identifier,
        uint256 timestamp,
        bytes ancillaryData,
        Request request
    );
    event DisputePrice(
        address indexed requester,
        bytes32 indexed identifier,
        uint256 timestamp,
        bytes ancillaryData,
        Request request
    );
    event Settle(
        address indexed requester,
        bytes32 indexed identifier,
        uint256 timestamp,
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
     * @param _identifier price identifier being requested.
     * @param _timestamp timestamp of the price being requested.
     * @param _ancillaryData ancillary data representing additional args being passed with the price request.
     * @param _currency ERC20 token used for payment of rewards and fees. Must be approved for use with the DVM.
     * @param _reward reward offered to a successful proposer. Will be pulled from the caller. Note: this can be 0,
     *               which could make sense if the contract requests and proposes the value in the same call or
     *               provides its own reward system.
     * @param _bond custom proposal bond to set for request. If set to 0, defaults to the final fee.
     * @param _customLiveness custom proposal liveness to set for request.
     * @return totalBond default bond + final fee that the proposer and disputer will be required to pay.
     */
    function requestPrice(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        IERC20 _currency,
        uint256 _reward,
        uint256 _bond,
        uint256 _customLiveness
    ) external override nonReentrant() returns (uint256 totalBond) {
        bytes32 requestId = _getId(msg.sender, _identifier, _timestamp, _ancillaryData);
        require(requests[requestId] == bytes32(0), "Request already initialized");
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "Unsupported identifier");
        require(_getCollateralWhitelist().isOnWhitelist(address(_currency)), "Unsupported currency");
        require(_timestamp <= getCurrentTime(), "Timestamp in future");
        require(
            _stampAncillaryData(_ancillaryData, msg.sender).length <= ancillaryBytesLimit,
            "Ancillary Data too long"
        );
        uint256 finalFee = _getStore().computeFinalFee(address(_currency)).rawValue;

        // Associate new request with ID
        Request memory request;
        request.currency = _currency;
        request.reward = _reward;
        request.finalFee = finalFee;
        request.bond = _bond != 0 ? _bond : finalFee;
        request.customLiveness = _customLiveness;

        if (_reward > 0) {
            _currency.safeTransferFrom(msg.sender, address(this), _reward);
        }

        _storeRequestHash(requestId, request);
        emit RequestPrice(msg.sender, _identifier, _timestamp, _ancillaryData, request);

        return request.bond.add(request.finalFee);
    }

    /**
     * @notice Proposes a price value on another address' behalf. Note: this address will receive any rewards that come
     * from this proposal. However, any bonds are pulled from the caller.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * propose a price for.
     * @param _proposer address to set as the proposer.
     * @param _proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function proposePriceFor(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request,
        address _proposer,
        int256 _proposedPrice
    ) public override nonReentrant() returns (uint256 totalBond) {
        require(_proposer != address(0), "proposer address must be non 0");
        require(
            _getState(_requester, _identifier, _timestamp, _ancillaryData, _request) ==
                OptimisticOracleInterface.State.Requested,
            "proposePriceFor: Requested"
        );
        bytes32 requestId = _getId(_requester, _identifier, _timestamp, _ancillaryData);
        _validateRequestHash(requestId, _request);

        // Associate newly proposed request params with ID
        Request memory proposedRequest =
            Request({
                proposer: _proposer, // Modified
                disputer: _request.disputer,
                currency: _request.currency,
                settled: _request.settled,
                proposedPrice: _proposedPrice, // Modified
                resolvedPrice: _request.resolvedPrice,
                expirationTime: getCurrentTime().add(
                    _request.customLiveness != 0 ? _request.customLiveness : defaultLiveness
                ), // Modified
                reward: _request.reward,
                finalFee: _request.finalFee,
                bond: _request.bond,
                customLiveness: _request.customLiveness
            });

        totalBond = proposedRequest.bond.add(proposedRequest.finalFee);
        if (totalBond > 0) {
            proposedRequest.currency.safeTransferFrom(msg.sender, address(this), totalBond);
        }

        _storeRequestHash(requestId, proposedRequest);
        emit ProposePrice(_requester, _identifier, _timestamp, _ancillaryData, proposedRequest);
    }

    /**
     * @notice Proposes a price value where caller is the proposer.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * propose a price for.
     * @param _proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function proposePrice(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request,
        int256 _proposedPrice
    ) external override returns (uint256 totalBond) {
        // Note: re-entrancy guard is done in the inner call.
        return
            proposePriceFor(_requester, _identifier, _timestamp, _ancillaryData, _request, msg.sender, _proposedPrice);
    }

    /**
     * @notice Combines logic of requestPrice and proposePrice while taking advantage of gas savings from not having to
     * overwrite Request params that a normal requestPrice() => proposePrice() flow would entail. Note: The proposer
     * will receive any rewards that come from this proposal. However, any bonds are pulled from the caller.
     * @dev The caller is the requester, but the proposer can be customized.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _currency ERC20 token used for payment of rewards and fees. Must be approved for use with the DVM.
     * @param _reward reward offered to a successful proposer. Will be pulled from the caller. Note: this can be 0,
     *               which could make sense if the contract requests and proposes the value in the same call or
     *               provides its own reward system.
     * @param _bond custom proposal bond to set for request. If set to 0, defaults to the final fee.
     * @param _customLiveness custom proposal liveness to set for request.
     * @param _proposer address to set as the proposer.
     * @param _proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function requestAndProposePriceFor(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        IERC20 _currency,
        uint256 _reward,
        uint256 _bond,
        uint256 _customLiveness,
        address _proposer,
        int256 _proposedPrice
    ) external override returns (uint256 totalBond) {
        bytes32 requestId = _getId(msg.sender, _identifier, _timestamp, _ancillaryData);
        require(requests[requestId] == bytes32(0), "Request already initialized");
        require(_proposer != address(0), "proposer address must be non 0");
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "Unsupported identifier");
        require(_getCollateralWhitelist().isOnWhitelist(address(_currency)), "Unsupported currency");
        require(_timestamp <= getCurrentTime(), "Timestamp in future");
        require(
            _stampAncillaryData(_ancillaryData, msg.sender).length <= ancillaryBytesLimit,
            "Ancillary Data too long"
        );
        uint256 finalFee = _getStore().computeFinalFee(address(_currency)).rawValue;

        // Associate new request with ID
        Request memory request;
        request.currency = _currency;
        request.reward = _reward;
        request.finalFee = finalFee;
        request.bond = _bond != 0 ? _bond : finalFee;
        request.customLiveness = _customLiveness;
        request.proposer = _proposer;
        request.proposedPrice = _proposedPrice;
        request.expirationTime = getCurrentTime().add(_customLiveness != 0 ? _customLiveness : defaultLiveness);

        // Pull reward from requester, who is the caller.
        if (_reward > 0) {
            _currency.safeTransferFrom(msg.sender, address(this), _reward);
        }
        // Pull proposal bond from caller.
        totalBond = request.bond.add(request.finalFee);
        if (totalBond > 0) {
            _currency.safeTransferFrom(msg.sender, address(this), totalBond);
        }

        _storeRequestHash(requestId, request);
        emit RequestPrice(msg.sender, _identifier, _timestamp, _ancillaryData, request);
        emit ProposePrice(msg.sender, _identifier, _timestamp, _ancillaryData, request);

        return request.bond.add(request.finalFee);
    }

    /**
     * @notice Disputes a price request with an active proposal on another address' behalf. Note: this address will
     * receive any rewards that come from this dispute. However, any bonds are pulled from the caller.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * dispute.
     * @param _disputer address to set as the disputer.
     * @param _requester sender of the initial price request.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the disputer once settled if the dispute was valid (the proposal was incorrect).
     */
    function disputePriceFor(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request,
        address _disputer,
        address _requester
    ) public override nonReentrant() returns (uint256 totalBond) {
        require(_disputer != address(0), "disputer address must be non 0");
        require(
            _getState(_requester, _identifier, _timestamp, _ancillaryData, _request) ==
                OptimisticOracleInterface.State.Proposed,
            "disputePriceFor: Proposed"
        );
        bytes32 requestId = _getId(_requester, _identifier, _timestamp, _ancillaryData);
        _validateRequestHash(requestId, _request);

        // Associate newly disputed request params with ID
        Request memory disputedRequest =
            Request({
                proposer: _request.proposer,
                disputer: _disputer, // Modified
                currency: _request.currency,
                settled: _request.settled,
                proposedPrice: _request.proposedPrice,
                resolvedPrice: _request.resolvedPrice,
                expirationTime: _request.expirationTime,
                reward: _request.reward,
                finalFee: _request.finalFee,
                bond: _request.bond,
                customLiveness: _request.customLiveness
            });

        uint256 finalFee = disputedRequest.finalFee;
        uint256 bond = disputedRequest.bond;
        totalBond = bond.add(finalFee);
        if (totalBond > 0) {
            disputedRequest.currency.safeTransferFrom(msg.sender, address(this), totalBond);
        }

        StoreInterface store = _getStore();

        // Avoids stack too deep compilation error.
        {
            // Along with the final fee, "burn" part of the loser's bond to ensure that a larger bond always makes it
            // proportionally more expensive to delay the resolution even if the proposer and disputer are the same
            // party.
            uint256 burnedBond = _computeBurnedBond(disputedRequest);

            // The total fee is the burned bond and the final fee added together.
            uint256 totalFee = finalFee.add(burnedBond);

            if (totalFee > 0) {
                disputedRequest.currency.safeIncreaseAllowance(address(store), totalFee);
                _getStore().payOracleFeesErc20(address(disputedRequest.currency), FixedPoint.Unsigned(totalFee));
            }
        }

        _getOracle().requestPrice(_identifier, _timestamp, _stampAncillaryData(_ancillaryData, _requester));

        _storeRequestHash(requestId, disputedRequest);
        emit DisputePrice(_requester, _identifier, _timestamp, _ancillaryData, disputedRequest);
    }

    /**
     * @notice Disputes a price request with an active proposal where caller is the disputer.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * dispute.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the disputer once settled if the dispute was valid (the proposal was incorrect).
     */
    function disputePrice(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) external override returns (uint256 totalBond) {
        // Note: re-entrancy guard is done in the inner call.
        return disputePriceFor(_identifier, _timestamp, _ancillaryData, _request, msg.sender, _requester);
    }

    /**
     * @notice Attempts to settle an outstanding price request. Will revert if it isn't settleable.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * settle.
     * @return payout the amount that the "winner" (proposer or disputer) receives on settlement. This amount includes
     * the returned bonds as well as additional rewards.
     * @return resolvedPrice the price that the request settled to.
     */
    function settle(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) external override nonReentrant() returns (uint256 payout, int256 resolvedPrice) {
        return _settle(_requester, _identifier, _timestamp, _ancillaryData, _request);
    }

    /**
     * @notice Computes the current state of a price request. See the State enum for more details.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters.
     * @return the State.
     */
    function getState(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) external override nonReentrant() returns (OptimisticOracleInterface.State) {
        return _getState(_requester, _identifier, _timestamp, _ancillaryData, _request);
    }

    /**
     * @notice Checks if a given request has resolved, expired or been settled (i.e the optimistic oracle has a price).
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters. The hash of these parameters must match with the request hash that is
     * associated with the price request unique ID {requester, identifier, timestamp, ancillaryData}, or this method
     * will revert.
     * @return boolean indicating true if price exists and false if not.
     */
    function hasPrice(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) public override nonReentrant() returns (bool) {
        bytes32 requestId = _getId(_requester, _identifier, _timestamp, _ancillaryData);
        _validateRequestHash(requestId, _request);
        OptimisticOracleInterface.State state =
            _getState(_requester, _identifier, _timestamp, _ancillaryData, _request);
        return
            state == OptimisticOracleInterface.State.Settled ||
            state == OptimisticOracleInterface.State.Resolved ||
            state == OptimisticOracleInterface.State.Expired;
    }

    /**
     * @notice Generates stamped ancillary data in the format that it would be used in the case of a price dispute.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _requester sender of the initial price request.
     * @return the stamped ancillary bytes.
     */
    function stampAncillaryData(bytes memory _ancillaryData, address _requester)
        public
        pure
        override
        returns (bytes memory)
    {
        return _stampAncillaryData(_ancillaryData, _requester);
    }

    // Returns hash of unique request identifiers. This contract maps request ID hashes to hashes of the request's
    // parameters.
    function _getId(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(_requester, _identifier, _timestamp, _ancillaryData));
    }

    // Returns hash of request parameters. These are mapped to the unique request ID to track a request's lifecycle.
    function _getRequestHash(Request memory _request) private pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _request.proposer,
                    _request.disputer,
                    _request.currency,
                    _request.settled,
                    _request.proposedPrice,
                    _request.resolvedPrice,
                    _request.expirationTime,
                    _request.reward,
                    _request.finalFee,
                    _request.bond,
                    _request.customLiveness
                )
            );
    }

    // Resolves a price request that has expired or been disputed and a price is available from the DVM. This will
    // revert if the unique request ID does not match the hashed request parameters. This also marks the request
    // as settled, therefore this method can only be triggered once per eligible request.
    function _settle(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) private returns (uint256 payout, int256 resolvedPrice) {
        bytes32 requestId = _getId(_requester, _identifier, _timestamp, _ancillaryData);
        _validateRequestHash(requestId, _request);

        // Associate settled request params with ID.
        Request memory settledRequest =
            Request({
                proposer: _request.proposer,
                disputer: _request.disputer,
                currency: _request.currency,
                settled: true, // Modified
                proposedPrice: _request.proposedPrice,
                resolvedPrice: _request.resolvedPrice,
                expirationTime: _request.expirationTime,
                reward: _request.reward,
                finalFee: _request.finalFee,
                bond: _request.bond,
                customLiveness: _request.customLiveness
            });

        OptimisticOracleInterface.State state =
            _getState(_requester, _identifier, _timestamp, _ancillaryData, _request);
        if (state == OptimisticOracleInterface.State.Expired) {
            // In the expiry case, just pay back the proposer's bond and final fee along with the reward.
            resolvedPrice = settledRequest.proposedPrice;
            settledRequest.resolvedPrice = resolvedPrice;
            payout = settledRequest.bond.add(settledRequest.finalFee).add(settledRequest.reward);
            settledRequest.currency.safeTransfer(settledRequest.proposer, payout);
        } else if (state == OptimisticOracleInterface.State.Resolved) {
            // In the Resolved case, pay either the disputer or the proposer the entire payout (+ bond and reward).
            resolvedPrice = _getOracle().getPrice(
                _identifier,
                _timestamp,
                _stampAncillaryData(_ancillaryData, _requester)
            );
            settledRequest.resolvedPrice = resolvedPrice;
            bool disputeSuccess = settledRequest.resolvedPrice != settledRequest.proposedPrice;
            uint256 bond = settledRequest.bond;

            // Unburned portion of the loser's bond = 1 - burned bond.
            uint256 unburnedBond = bond.sub(_computeBurnedBond(settledRequest));

            // Winner gets:
            // - Their bond back.
            // - The unburned portion of the loser's bond.
            // - Their final fee back.
            // - The request reward (if not already refunded -- if refunded, it will be set to 0).
            payout = bond.add(unburnedBond).add(settledRequest.finalFee).add(settledRequest.reward);
            settledRequest.currency.safeTransfer(
                disputeSuccess ? settledRequest.disputer : settledRequest.proposer,
                payout
            );
        } else {
            revert("_settle: not settleable");
        }

        _storeRequestHash(requestId, settledRequest);
        emit Settle(_requester, _identifier, _timestamp, _ancillaryData, settledRequest);
    }

    function _computeBurnedBond(Request memory _request) private pure returns (uint256) {
        // burnedBond = floor(bond / 2)
        return _request.bond.div(2);
    }

    function _validateLiveness(uint256 _liveness) private pure {
        require(_liveness < 5200 weeks, "Liveness too large");
        require(_liveness > 0, "Liveness cannot be 0");
    }

    function _validateRequestHash(bytes32 _requestId, Request memory _request) private view {
        bytes32 requestHash = requests[_requestId];
        bytes32 requestHashToValidate = _getRequestHash(_request);
        require(requestHash == requestHashToValidate, "Hashed request params do not match existing request hash");
    }

    function _storeRequestHash(bytes32 _requestId, Request memory _request) internal {
        bytes32 requestHash = _getRequestHash(_request);
        requests[_requestId] = requestHash;
    }

    function _getState(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) internal view returns (OptimisticOracleInterface.State) {
        // Note: This function does not check whether all of the _request parameter values are correct. For example,
        // the _request.reward could be any value and it would not impact this function's return value. Therefore, it
        // is the caller's responsibility to check that _request matches with the expected ID corresponding to
        // {requester, identifier, timestamp, ancillaryData} via _validateRequestHash().
        if (address(_request.currency) == address(0)) {
            return OptimisticOracleInterface.State.Invalid;
        }

        if (_request.proposer == address(0)) {
            return OptimisticOracleInterface.State.Requested;
        }

        if (_request.settled) {
            return OptimisticOracleInterface.State.Settled;
        }

        if (_request.disputer == address(0)) {
            return
                _request.expirationTime <= getCurrentTime()
                    ? OptimisticOracleInterface.State.Expired
                    : OptimisticOracleInterface.State.Proposed;
        }

        return
            _getOracle().hasPrice(_identifier, _timestamp, _stampAncillaryData(_ancillaryData, _requester))
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
    function _stampAncillaryData(bytes memory _ancillaryData, address _requester) internal pure returns (bytes memory) {
        // Since this contract will be the one to formally submit DVM price requests, its useful for voters to know who
        // the original requester was.
        return AncillaryData.appendKeyValueAddress(_ancillaryData, "ooRequester", _requester);
    }
}
