// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../../data-verification-mechanism/interfaces/StoreInterface.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/implementation/Constants.sol";
import "../implementation/SkinnyOptimisticOracleV2.sol";

// This is just a test contract to make requests to the optimistic oracle.
contract SkinnyOptimisticV2RequesterTest {
    using SafeMath for uint256;

    SkinnyOptimisticOracleV2 optimisticOracle;
    bool public shouldRevert = false;

    // Finder to provide addresses for DVM contracts.
    FinderInterface public finder;

    // State variables to track incoming calls.
    bytes32 public identifier;
    uint32 public timestamp;
    bytes public ancillaryData;
    SkinnyOptimisticOracleV2.Request public request;

    // Manually set an expiration timestamp to simulate expiry price requests
    uint256 public expirationTimestamp;

    constructor(SkinnyOptimisticOracleV2 _optimisticOracle, FinderInterface _finderAddress) {
        optimisticOracle = _optimisticOracle;
        finder = _finderAddress;
    }

    function requestAndProposePriceFor(
        bytes32 _identifier,
        uint32 _timestamp,
        bytes memory _ancillaryData,
        IERC20 currency,
        uint256 reward,
        SkinnyOptimisticOracleV2Interface.RequestSettings memory requestSettings,
        address proposer,
        int256 proposedPrice
    ) external {
        uint256 finalFee = _getStore().computeFinalFee(address(currency)).rawValue;

        currency.approve(address(optimisticOracle), reward.add(requestSettings.bond).add(finalFee));
        optimisticOracle.requestAndProposePriceFor(
            _identifier,
            _timestamp,
            _ancillaryData,
            currency,
            reward,
            requestSettings,
            proposer,
            proposedPrice
        );
    }

    function requestPrice(
        bytes32 _identifier,
        uint32 _timestamp,
        bytes memory _ancillaryData,
        IERC20 currency,
        uint256 reward,
        SkinnyOptimisticOracleV2Interface.RequestSettings memory requestSettings
    ) external {
        currency.approve(address(optimisticOracle), reward);
        optimisticOracle.requestPrice(_identifier, _timestamp, _ancillaryData, currency, reward, requestSettings);
    }

    function setExpirationTimestamp(uint256 _expirationTimestamp) external {
        expirationTimestamp = _expirationTimestamp;
    }

    function setRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function priceProposed(
        bytes32 _identifier,
        uint32 _timestamp,
        bytes memory _ancillaryData,
        SkinnyOptimisticOracleV2.Request memory _request
    ) external {
        require(!shouldRevert);
        identifier = _identifier;
        timestamp = _timestamp;
        ancillaryData = _ancillaryData;
        request = _request;
    }

    function priceDisputed(
        bytes32 _identifier,
        uint32 _timestamp,
        bytes memory _ancillaryData,
        SkinnyOptimisticOracleV2.Request memory _request
    ) external {
        require(!shouldRevert);
        identifier = _identifier;
        timestamp = _timestamp;
        ancillaryData = _ancillaryData;
        request = _request;
    }

    function priceSettled(
        bytes32 _identifier,
        uint32 _timestamp,
        bytes memory _ancillaryData,
        SkinnyOptimisticOracleV2.Request memory _request
    ) external {
        require(!shouldRevert);
        identifier = _identifier;
        timestamp = _timestamp;
        ancillaryData = _ancillaryData;
        request = _request;
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }
}
