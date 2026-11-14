// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @notice Minimal interface of the fx-portal root tunnel entry point used by the relayer.
 */
interface IFxRootTunnelReceiver {
    function receiveMessage(bytes memory inputData) external;
}

/**
 * @title Permissionless helper to relay large Polygon exit proofs to a root tunnel in several transactions.
 * @notice Exit payloads for Polygon transactions that batch many messages can exceed the 128 KB transaction size limit
 * of Ethereum clients and, in the worst case, the EIP-7825 per transaction gas cap on calldata cost alone. This
 * contract lets anyone upload the payload in pieces as immutable data contracts (SSTORE2 style) and then call
 * `receiveMessage` on the root tunnel with the reassembled payload built in memory.
 * @dev This contract holds no state and performs no proof verification: the root tunnel validates the payload exactly
 * as if it were submitted directly. Callers usually pass the RLP list header as `prefix`, the first 9 RLP items split
 * into chunks of at most `MAX_CHUNK_SIZE` bytes as `chunks` and the encoded log index item as `suffix`, but any split
 * of the payload works.
 */
contract RootTunnelChunkedRelayer {
    // Max data bytes per chunk: the runtime code (0x00 STOP prefix + data) must fit the EIP-170 limit of 24576 bytes.
    uint256 public constant MAX_CHUNK_SIZE = 24575;

    // Root tunnel receiving the reassembled payloads.
    address public immutable rootTunnel;

    event ChunkStored(address indexed pointer, bytes32 indexed dataHash, uint256 size);
    event MessageRelayed(bytes32 indexed payloadHash);

    /**
     * @notice Constructs the relayer.
     * @param _rootTunnel address of the root tunnel (e.g. OracleRootTunnel). Must be a deployed contract.
     */
    constructor(address _rootTunnel) {
        require(_rootTunnel != address(0) && _rootTunnel.code.length > 0, "Invalid root tunnel");
        rootTunnel = _rootTunnel;
    }

    /**
     * @notice Stores a chunk of payload data as the runtime code of a contract deployed with CREATE2.
     * @dev Idempotent: if the chunk was already stored, its address is returned without deploying again or emitting
     * an event. The deployed code is `0x00 ++ data` so the data contract stops immediately if ever called.
     * @param data chunk data, between 1 and MAX_CHUNK_SIZE bytes.
     * @return pointer address of the data contract holding the chunk.
     */
    function storeChunk(bytes calldata data) external returns (address pointer) {
        require(data.length > 0 && data.length <= MAX_CHUNK_SIZE, "Invalid chunk size");
        bytes memory initCode = _initCode(data);
        bytes32 salt = keccak256(data);
        pointer = _predict(salt, keccak256(initCode));
        if (pointer.code.length > 0) return pointer;

        address deployed;
        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(deployed != address(0) && deployed == pointer, "Chunk deployment failed");
        emit ChunkStored(pointer, salt, data.length);
    }

    /**
     * @notice Returns the address at which `storeChunk(data)` stores (or has stored) the given chunk.
     * @param data chunk data.
     * @return address of the data contract for this chunk. It may not be deployed yet.
     */
    function chunkAddress(bytes calldata data) external view returns (address) {
        return _predict(keccak256(data), keccak256(_initCode(data)));
    }

    /**
     * @notice Reassembles `prefix ++ chunk data... ++ suffix` and passes it to `receiveMessage` on the root tunnel.
     * @dev Any revert from the root tunnel (e.g. "FxRootTunnel: EXIT_ALREADY_PROCESSED") is bubbled up verbatim.
     * The calldata for `receiveMessage` is built in a single memory allocation to avoid copying the payload twice.
     * @param prefix bytes placed before the chunk data.
     * @param chunks addresses of data contracts created by `storeChunk`, in payload order.
     * @param suffix bytes placed after the chunk data.
     */
    function relay(
        bytes calldata prefix,
        address[] calldata chunks,
        bytes calldata suffix
    ) external {
        uint256 total = prefix.length + suffix.length;
        for (uint256 i = 0; i < chunks.length; i++) {
            uint256 size = chunks[i].code.length;
            require(size > 1, "Missing chunk");
            total += size - 1;
        }

        address target = rootTunnel;
        bytes4 selector = IFxRootTunnelReceiver.receiveMessage.selector;
        bytes32 payloadHash;
        assembly {
            // Layout: selector (4) | offset 0x20 (32) | length (32) | payload padded to a multiple of 32 bytes.
            let buf := mload(0x40)
            mstore(buf, selector)
            mstore(add(buf, 0x04), 0x20)
            mstore(add(buf, 0x24), total)
            let data := add(buf, 0x44)
            let paddedLength := and(add(total, 0x1f), not(0x1f))
            // Zero the last word so that the ABI padding is clean (copies below overwrite the payload bytes).
            if paddedLength {
                mstore(add(data, sub(paddedLength, 0x20)), 0)
            }

            let ptr := data
            calldatacopy(ptr, prefix.offset, prefix.length)
            ptr := add(ptr, prefix.length)
            for {
                let i := 0
            } lt(i, chunks.length) {
                i := add(i, 1)
            } {
                let chunk := calldataload(add(chunks.offset, shl(5, i)))
                let size := sub(extcodesize(chunk), 1)
                extcodecopy(chunk, ptr, 1, size)
                ptr := add(ptr, size)
            }
            calldatacopy(ptr, suffix.offset, suffix.length)

            payloadHash := keccak256(data, total)
            let callLength := add(0x44, paddedLength)
            mstore(0x40, add(buf, callLength))

            if iszero(call(gas(), target, 0, buf, callLength, 0, 0)) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
        emit MessageRelayed(payloadHash);
    }

    // Init code that returns `0x00 ++ data` as runtime code:
    // PUSH2 len+1 | DUP1 | PUSH1 0x0a | RETURNDATASIZE | CODECOPY | RETURNDATASIZE | RETURN, then 0x00 and data.
    function _initCode(bytes calldata data) private pure returns (bytes memory) {
        return abi.encodePacked(hex"61", uint16(data.length + 1), hex"80600a3d393df300", data);
    }

    function _predict(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
