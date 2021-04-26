pragma solidity ^0.6.0;

/**
    @title Interface for ChainSafe Bridge contract enabling cross-chain messaging.
 */
interface BridgeInterface {
    function deposit(
        uint8 destinationChainID,
        bytes32 resourceID,
        bytes calldata data
    ) external;
}
