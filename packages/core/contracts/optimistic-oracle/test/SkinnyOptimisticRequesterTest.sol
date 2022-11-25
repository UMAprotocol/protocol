// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../../data-verification-mechanism/interfaces/StoreInterface.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../previous-versions/SkinnyOptimisticOracle.sol";
import "../../data-verification-mechanism/implementation/Constants.sol";

// This is just a test contract to make requests to the optimistic oracle.
contract SkinnyOptimisticRequesterTest {
    using SafeMath for uint256;

    SkinnyOptimisticOracle optimisticOracle;
    bool public shouldRevert = false;

    // Finder to provide addresses for DVM contracts.
    FinderInterface public finder;

    // State variables to track incoming calls.
    bytes32 public identifier;
    uint32 public timestamp;
    bytes public ancillaryData;
    SkinnyOptimisticOracle.Request public request;

    // Manually set an expiration timestamp to simulate expiry price requests
    uint256 public expirationTimestamp;

    constructor(SkinnyOptimisticOracle _optimisticOracle, FinderInterface _finderAddress) {
        optimisticOracle = _optimisticOracle;
        finder = _finderAddress;
    }

    function requestAndProposePriceFor(
        bytes32 _identifier,
        uint32 _timestamp,
        bytes memory _ancillaryData,
        IERC20 currency,
        uint256 reward,
        uint256 bond,
        uint256 customLiveness,
        address proposer,
        int256 proposedPrice
    ) external {
        uint256 finalFee = _getStore().computeFinalFee(address(currency)).rawValue;

        currency.approve(address(optimisticOracle), reward.add(bond).add(finalFee));
        optimisticOracle.requestAndProposePriceFor(
            _identifier,
            _timestamp,
            _ancillaryData,
            currency,
            reward,
            bond,
            customLiveness,
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
        uint256 bond,
        uint256 customLiveness
    ) external {
        currency.approve(address(optimisticOracle), reward);
        optimisticOracle.requestPrice(_identifier, _timestamp, _ancillaryData, currency, reward, bond, customLiveness);
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
        SkinnyOptimisticOracle.Request memory _request
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
        SkinnyOptimisticOracle.Request memory _request
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
        SkinnyOptimisticOracle.Request memory _request
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
