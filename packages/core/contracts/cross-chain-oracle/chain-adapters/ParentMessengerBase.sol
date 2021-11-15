// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract ParentMessengerBase is Ownable {
    uint256 public childChainId;

    address public childMessenger;

    address public oracleHub;
    address public governorHub;

    address public oracleSpoke;
    address public governorSpoke;

    event ChildMessengerSet(address indexed childMessenger);
    event OracleHubSet(address indexed oracleHub);
    event GovernorHubSet(address indexed governorHub);
    event OracleSpokeSet(address indexed oracleSpoke);
    event GovernorSpokeSet(address indexed governorSpoke);

    modifier onlyHubContract() {
        require(msg.sender == oracleHub || msg.sender == governorHub, "Only privileged caller");
        _;
    }

    /**
     * @notice Construct the ParentMessengerBase contract.
     * @param _childChainId The chain id of the L2 network this messenger should connect to.
     **/
    constructor(uint256 _childChainId) {
        childChainId = _childChainId;
    }

    /*******************
     *  OWNER METHODS  *
     *******************/

    /**
     * @notice Changes the stored address of the child messenger, deployed on L2.
     * @dev The caller of this function must be the owner. This should be set to the DVM governor.
     * @param newChildMessenger address of the new child messenger, deployed on L2.
     */
    function setChildMessenger(address newChildMessenger) public onlyOwner {
        childMessenger = newChildMessenger;
        emit ChildMessengerSet(childMessenger);
    }

    /**
     * @notice Changes the stored address of the Oracle hub, deployed on L1.
     * @dev The caller of this function must be the owner. This should be set to the DVM governor.
     * @param newOracleHub address of the new oracle hub, deployed on L1 Ethereum.
     */
    function setOracleHub(address newOracleHub) public onlyOwner {
        oracleHub = newOracleHub;
        emit OracleHubSet(oracleHub);
    }

    /**
     * @notice Changes the stored address of the Governor hub, deployed on L1.
     * @dev The caller of this function must be the owner. This should be set to the DVM governor.
     * @param newGovernorHub address of the new governor hub, deployed on L1 Ethereum.
     */
    function setGovernorHub(address newGovernorHub) public onlyOwner {
        governorHub = newGovernorHub;
        emit GovernorHubSet(governorHub);
    }

    /**
     * @notice Changes the stored address of the oracle spoke, deployed on L2.
     * @dev The caller of this function must be the owner. This should be set to the DVM governor.
     * @param newOracleSpoke address of the new oracle spoke, deployed on L2.
     */
    function setOracleSpoke(address newOracleSpoke) public onlyOwner {
        oracleSpoke = newOracleSpoke;
        emit OracleSpokeSet(oracleSpoke);
    }

    /**
     * @notice Changes the stored address of the governor spoke, deployed on L2.
     * @dev The caller of this function must be the owner. This should be set to the DVM governor.
     * @param newGovernorSpoke address of the new governor spoke, deployed on L2.
     */
    function setGovernorSpoke(address newGovernorSpoke) public onlyOwner {
        governorSpoke = newGovernorSpoke;
        emit GovernorSpokeSet(governorSpoke);
    }
}
