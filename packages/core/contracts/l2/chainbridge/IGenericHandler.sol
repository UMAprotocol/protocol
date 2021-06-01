// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
    @title Interface for handler that handles generic deposits and deposit executions.
    @dev Copied directly from here: https://github.com/ChainSafe/chainbridge-solidity/releases/tag/v1.0.0.
    @author ChainSafe Systems.
 */
interface IGenericHandler {
    /**
        @notice Correlates {resourceID} with {contractAddress}, {depositFunctionSig}, and {executeFunctionSig}.
        @param resourceID ResourceID to be used when making deposits.
        @param contractAddress Address of contract to be called when a deposit is made and a deposited is executed.
        @param depositFunctionSig Function signature of method to be called in {contractAddress} when a deposit is made.
        @param executeFunctionSig Function signature of method to be called in {contractAddress} when a deposit is executed.
     */
    function setResource(
        bytes32 resourceID,
        address contractAddress,
        bytes4 depositFunctionSig,
        bytes4 executeFunctionSig
    ) external;
}
