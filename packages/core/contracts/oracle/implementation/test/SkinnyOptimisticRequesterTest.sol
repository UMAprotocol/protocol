// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../../interfaces/StoreInterface.sol";
import "../../interfaces/FinderInterface.sol";
import "../SkinnyOptimisticOracle.sol";
import "../Constants.sol";

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

    constructor(SkinnyOptimisticOracle _optimisticOracle, FinderInterface _finderAddress) {
        optimisticOracle = _optimisticOracle;
        finder = _finderAddress;
    }

    function requestAndProposePriceFor(
        bytes32 _identifier,
        uint32 _timestamp,
        bytes memory _ancillaryData,
        IERC20 _currency,
        uint256 _reward,
        uint256 _bond,
        uint256 _customLiveness,
        address _proposer,
        int256 _proposedPrice
    ) external {
        uint256 finalFee = _getStore().computeFinalFee(address(_currency)).rawValue;

        _currency.approve(address(optimisticOracle), _reward.add(_bond).add(finalFee));
        optimisticOracle.requestAndProposePriceFor(
            _identifier,
            _timestamp,
            _ancillaryData,
            _currency,
            _reward,
            _bond,
            _customLiveness,
            _proposer,
            _proposedPrice
        );
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
