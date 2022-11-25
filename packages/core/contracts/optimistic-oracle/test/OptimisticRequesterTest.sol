// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../implementation/OptimisticOracleV2.sol";

// This is just a test contract to make requests to the optimistic oracle.
contract OptimisticRequesterTest is OptimisticRequester {
    OptimisticOracleV2 optimisticOracle;
    bool public shouldRevert = false;

    // State variables to track incoming calls.
    bytes32 public identifier;
    uint256 public timestamp;
    bytes public ancillaryData;
    uint256 public refund;
    int256 public price;

    // Implement collateralCurrency so that this contract simulates a financial contract whose collateral
    // token can be fetched by off-chain clients.
    IERC20 public collateralCurrency;

    // Manually set an expiration timestamp to simulate expiry price requests
    uint256 public expirationTimestamp;

    constructor(OptimisticOracleV2 _optimisticOracle) {
        optimisticOracle = _optimisticOracle;
    }

    function requestPrice(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        IERC20 currency,
        uint256 reward
    ) external {
        // Set collateral currency to last requested currency:
        collateralCurrency = currency;

        currency.approve(address(optimisticOracle), reward);
        optimisticOracle.requestPrice(_identifier, _timestamp, _ancillaryData, currency, reward);
    }

    function settleAndGetPrice(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData
    ) external returns (int256) {
        return optimisticOracle.settleAndGetPrice(_identifier, _timestamp, _ancillaryData);
    }

    function setBond(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        uint256 bond
    ) external {
        optimisticOracle.setBond(_identifier, _timestamp, _ancillaryData, bond);
    }

    function setRefundOnDispute(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData
    ) external {
        optimisticOracle.setRefundOnDispute(_identifier, _timestamp, _ancillaryData);
    }

    function setCustomLiveness(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        uint256 customLiveness
    ) external {
        optimisticOracle.setCustomLiveness(_identifier, _timestamp, _ancillaryData, customLiveness);
    }

    function setEventBased(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData
    ) external {
        optimisticOracle.setEventBased(_identifier, _timestamp, _ancillaryData);
    }

    function setCallbacks(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        bool _callbackOnPriceProposed,
        bool _callbackOnPriceDisputed,
        bool _callbackOnPriceSettled
    ) external {
        optimisticOracle.setCallbacks(
            _identifier,
            _timestamp,
            _ancillaryData,
            _callbackOnPriceProposed,
            _callbackOnPriceDisputed,
            _callbackOnPriceSettled
        );
    }

    function setRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function setExpirationTimestamp(uint256 _expirationTimestamp) external {
        expirationTimestamp = _expirationTimestamp;
    }

    function clearState() external {
        delete identifier;
        delete timestamp;
        delete refund;
        delete price;
    }

    function priceProposed(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData
    ) external override {
        require(!shouldRevert);
        identifier = _identifier;
        timestamp = _timestamp;
        ancillaryData = _ancillaryData;
    }

    function priceDisputed(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        uint256 _refund
    ) external override {
        require(!shouldRevert);
        identifier = _identifier;
        timestamp = _timestamp;
        ancillaryData = _ancillaryData;
        refund = _refund;
    }

    function priceSettled(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        int256 _price
    ) external override {
        require(!shouldRevert);
        identifier = _identifier;
        timestamp = _timestamp;
        ancillaryData = _ancillaryData;
        price = _price;
    }
}
