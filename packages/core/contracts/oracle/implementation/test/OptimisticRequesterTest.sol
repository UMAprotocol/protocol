// SPDX-License-Identifier: AGPL-3.0-only
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../OptimisticOracle.sol";

// This is just a test contract to make requests to the optimistic oracle.
contract OptimisticRequesterTest is OptimisticRequester {
    OptimisticOracle optimisticOracle;
    bool public shouldRevert = false;

    // State variables to track incoming calls.
    bytes32 public identifier;
    uint256 public timestamp;
    bytes public ancillaryData;
    uint256 public refund;
    int256 public price;

    constructor(OptimisticOracle _optimisticOracle) public {
        optimisticOracle = _optimisticOracle;
    }

    function requestPrice(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        IERC20 currency,
        uint256 reward
    ) external {
        currency.approve(address(optimisticOracle), reward);
        optimisticOracle.requestPrice(_identifier, _timestamp, _ancillaryData, currency, reward);
    }

    function getPrice(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData
    ) external returns (int256) {
        return optimisticOracle.getPrice(_identifier, _timestamp, _ancillaryData);
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

    function setRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
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
