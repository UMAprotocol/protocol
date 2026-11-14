// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

import "../../../contracts/polygon-cross-chain-oracle/RootTunnelChunkedRelayer.sol";
import "../../../contracts/polygon-cross-chain-oracle/OracleRootTunnel.sol";

// Records what it receives. Taking `bytes memory` makes it copy the full payload into memory like a real root tunnel.
contract RecordingRootTunnel {
    bytes32 public lastHash;
    uint256 public lastLength;
    uint256 public calls;

    function receiveMessage(bytes memory inputData) external {
        lastHash = keccak256(inputData);
        lastLength = inputData.length;
        calls++;
    }
}

contract RevertingRootTunnel {
    bool public useCustomError;

    function setUseCustomError(bool value) external {
        useCustomError = value;
    }

    function receiveMessage(bytes memory) external view {
        if (useCustomError) {
            // Raw revert data equal to a custom error `CustomFailure(uint256)` with argument 42.
            bytes memory data = abi.encodeWithSignature("CustomFailure(uint256)", uint256(42));
            assembly {
                revert(add(data, 0x20), mload(data))
            }
        }
        revert("FxRootTunnel: EXIT_ALREADY_PROCESSED");
    }
}

contract CheckpointManagerMock is ICheckpointManager {
    function setHeaderBlock(
        uint256 headerNumber,
        bytes32 root,
        uint256 start,
        uint256 end
    ) external {
        headerBlocks[headerNumber] = HeaderBlock(root, start, end, block.timestamp, address(0));
    }
}

contract OracleMock {
    uint256 public requests;

    function requestPrice(
        bytes32,
        uint256,
        bytes memory
    ) external {
        requests++;
    }
}

contract FinderMock {
    address public oracle;

    constructor(address _oracle) {
        oracle = _oracle;
    }

    function getImplementationAddress(bytes32) external view returns (address) {
        return oracle;
    }
}

abstract contract RootTunnelChunkedRelayerTestBase is Test {
    event ChunkStored(address indexed pointer, bytes32 indexed dataHash, uint256 size);
    event MessageRelayed(bytes32 indexed payloadHash);

    uint256 constant MAX = 24575;
    uint256 constant EIP7825_TX_GAS_CAP = 16_777_216;

    RootTunnelChunkedRelayer relayer;

    function _randomBytes(uint256 seed, uint256 length) internal pure returns (bytes memory out) {
        out = new bytes(length);
        bytes32 word;
        for (uint256 i = 0; i < length; i++) {
            if (i % 32 == 0) word = keccak256(abi.encode(seed, i));
            out[i] = word[i % 32];
        }
    }

    function _copy(
        uint256 dest,
        uint256 src,
        uint256 len
    ) internal pure {
        // Overshooting the last word is fine: callers only copy into the most recently allocated buffer, in order.
        for (uint256 i = 0; i < len; i += 32) {
            assembly {
                mstore(add(dest, i), mload(add(src, i)))
            }
        }
    }

    function _slice(
        bytes memory data,
        uint256 start,
        uint256 length
    ) internal pure returns (bytes memory out) {
        out = new bytes(length);
        uint256 src;
        uint256 dest;
        assembly {
            src := add(add(data, 0x20), start)
            dest := add(out, 0x20)
        }
        _copy(dest, src, length);
        // Clean bytes after the slice in its last word.
        assembly {
            mstore(add(dest, length), 0)
        }
    }

    function _concat(bytes[] memory parts) internal pure returns (bytes memory out) {
        uint256 total;
        for (uint256 i = 0; i < parts.length; i++) total += parts[i].length;
        out = new bytes(total);
        uint256 dest;
        assembly {
            dest := add(out, 0x20)
        }
        for (uint256 i = 0; i < parts.length; i++) {
            bytes memory part = parts[i];
            uint256 src;
            assembly {
                src := add(part, 0x20)
            }
            _copy(dest, src, part.length);
            dest += part.length;
        }
        assembly {
            mstore(dest, 0)
        }
    }

    // Stores `data` split into pieces of the given sizes (the last piece takes the remainder) and returns the pointers.
    function _storeSplit(bytes memory data, uint256[] memory sizes) internal returns (address[] memory chunks) {
        chunks = new address[](sizes.length);
        uint256 offset;
        for (uint256 i = 0; i < sizes.length; i++) {
            chunks[i] = relayer.storeChunk(_slice(data, offset, sizes[i]));
            offset += sizes[i];
        }
        require(offset == data.length, "bad split");
    }

    // Stores `data` in full-size chunks (last one smaller).
    function _storeFull(bytes memory data) internal returns (address[] memory chunks) {
        uint256 n = (data.length + MAX - 1) / MAX;
        uint256[] memory sizes = new uint256[](n);
        for (uint256 i = 0; i < n; i++) sizes[i] = i == n - 1 ? data.length - MAX * (n - 1) : MAX;
        return _storeSplit(data, sizes);
    }

    // ---- Minimal RLP encoder ----

    function _minimalBigEndian(uint256 value) internal pure returns (bytes memory out) {
        uint256 n;
        for (uint256 v = value; v > 0; v >>= 8) n++;
        out = new bytes(n);
        for (uint256 i = 0; i < n; i++) out[i] = bytes1(uint8(value >> (8 * (n - 1 - i))));
    }

    function _rlpHeader(uint256 length, uint8 offset) internal pure returns (bytes memory) {
        if (length < 56) return abi.encodePacked(uint8(offset + length));
        bytes memory lengthBytes = _minimalBigEndian(length);
        return abi.encodePacked(uint8(offset + 55 + lengthBytes.length), lengthBytes);
    }

    function _rlpBytes(bytes memory data) internal pure returns (bytes memory) {
        if (data.length == 1 && uint8(data[0]) < 0x80) return data;
        return abi.encodePacked(_rlpHeader(data.length, 0x80), data);
    }

    function _rlpUint(uint256 value) internal pure returns (bytes memory) {
        return _rlpBytes(_minimalBigEndian(value));
    }

    function _rlpList(bytes[] memory items) internal pure returns (bytes memory) {
        bytes memory body = _concat(items);
        return abi.encodePacked(_rlpHeader(body.length, 0xc0), body);
    }

    function _rlpList2(bytes memory a, bytes memory b) internal pure returns (bytes memory) {
        bytes[] memory items = new bytes[](2);
        items[0] = a;
        items[1] = b;
        return _rlpList(items);
    }

    // Gas used by the last call, from the callee's perspective (so test frame memory costs are excluded). Decoded by
    // hand because the `Vm.Gas` struct layout differs between forge-std and forge versions.
    function _lastCallGasUsed() internal view returns (uint256) {
        (bool success, bytes memory ret) = address(vm).staticcall(abi.encodeWithSignature("lastCallGas()"));
        require(success, "lastCallGas failed");
        (, uint64 gasTotalUsed) = abi.decode(ret, (uint64, uint64));
        return gasTotalUsed;
    }

    // EIP-2028 / EIP-7623 intrinsic gas of a tx with this calldata: 21000 + 4 gas per token (16 per non-zero byte,
    // 4 per zero byte), with a floor of 21000 + 10 gas per token for the whole tx.
    function _calldataGas(bytes memory callData) internal pure returns (uint256 standard, uint256 floor) {
        uint256 tokens;
        for (uint256 i = 0; i < callData.length; i++) tokens += callData[i] == 0 ? 1 : 4;
        standard = 21000 + tokens * 4;
        floor = 21000 + tokens * 10;
    }
}

contract RootTunnelChunkedRelayerTest is RootTunnelChunkedRelayerTestBase {
    RecordingRootTunnel recorder;

    function setUp() public {
        recorder = new RecordingRootTunnel();
        relayer = new RootTunnelChunkedRelayer(address(recorder));
    }

    /****************************************
     *          STORE CHUNK TESTS           *
     ****************************************/

    function test_ConstructorRejectsInvalidRootTunnel() public {
        vm.expectRevert(bytes("Invalid root tunnel"));
        new RootTunnelChunkedRelayer(address(0));
        vm.expectRevert(bytes("Invalid root tunnel"));
        new RootTunnelChunkedRelayer(address(0xBEEF)); // No code.
        assertEq(relayer.rootTunnel(), address(recorder));
        assertEq(relayer.MAX_CHUNK_SIZE(), MAX);
    }

    function test_StoreChunkRoundTrip() public {
        bytes memory data = _randomBytes(1, 1000);
        address predicted = relayer.chunkAddress(data);
        assertEq(predicted.code.length, 0);

        vm.expectEmit(true, true, false, true, address(relayer));
        emit ChunkStored(predicted, keccak256(data), data.length);
        address pointer = relayer.storeChunk(data);

        assertEq(pointer, predicted);
        assertEq(pointer.code, abi.encodePacked(hex"00", data));
        assertEq(relayer.chunkAddress(data), pointer);
    }

    function test_StoreChunkSingleByteAndLeadingZeros() public {
        bytes memory one = hex"00";
        address p1 = relayer.storeChunk(one);
        assertEq(p1.code, hex"0000");
        bytes memory zeros = new bytes(100);
        address p2 = relayer.storeChunk(zeros);
        assertEq(p2.code, abi.encodePacked(hex"00", zeros));
        assertTrue(p1 != p2);
    }

    function test_StoreChunkIsIdempotent() public {
        bytes memory data = _randomBytes(2, MAX);
        address first = relayer.storeChunk(data);
        uint256 firstGas = _lastCallGasUsed();

        vm.recordLogs();
        address second = relayer.storeChunk(data);
        uint256 gasUsed = _lastCallGasUsed();
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(second, first);
        // Without --isolate this is execution gas only (~25k vs ~5M for the deployment); with --isolate both include
        // the intrinsic and calldata gas (~1M), which still keeps the repeated call well below the first one.
        assertLt(gasUsed, firstGas / 4);
        emit log_named_uint("storeChunk(24575 bytes) first call gas", firstGas);
        emit log_named_uint("storeChunk(24575 bytes) repeated call gas", gasUsed);
    }

    function test_StoreChunkSizeBounds() public {
        vm.expectRevert(bytes("Invalid chunk size"));
        relayer.storeChunk("");

        vm.expectRevert(bytes("Invalid chunk size"));
        relayer.storeChunk(new bytes(MAX + 1));

        bytes memory maxData = _randomBytes(3, MAX);
        address pointer = relayer.storeChunk(maxData);
        assertEq(pointer.code.length, 24576); // Exactly the EIP-170 limit.
        assertEq(pointer.code, abi.encodePacked(hex"00", maxData));
    }

    function testFuzz_ChunkAddressPrediction(bytes memory data) public {
        vm.assume(data.length > 0 && data.length <= MAX);
        address predicted = relayer.chunkAddress(data);
        assertEq(relayer.storeChunk(data), predicted);
        assertEq(predicted.code, abi.encodePacked(hex"00", data));
    }

    function test_DataContractIsInert() public {
        address pointer = relayer.storeChunk(hex"ff"); // Would be SELFDESTRUCT if executed from byte 0.
        (bool success, bytes memory ret) = pointer.call(hex"deadbeef");
        assertTrue(success);
        assertEq(ret.length, 0);
        assertEq(pointer.code, hex"00ff");
    }

    /****************************************
     *              RELAY TESTS             *
     ****************************************/

    function _assertRelays(
        bytes memory prefix,
        address[] memory chunks,
        bytes memory suffix,
        bytes memory expected
    ) internal {
        vm.expectEmit(true, false, false, true, address(relayer));
        emit MessageRelayed(keccak256(expected));
        relayer.relay(prefix, chunks, suffix);
        assertEq(recorder.lastLength(), expected.length);
        assertEq(recorder.lastHash(), keccak256(expected));
    }

    function test_RelayReassemblesVariedChunks() public {
        bytes memory body = _randomBytes(4, 3 * MAX - 1000);
        uint256[] memory sizes = new uint256[](6);
        sizes[0] = 1;
        sizes[1] = MAX;
        sizes[2] = 31;
        sizes[3] = 33;
        sizes[4] = MAX;
        sizes[5] = body.length - 1 - MAX - 31 - 33 - MAX;
        address[] memory chunks = _storeSplit(body, sizes);

        bytes memory prefix = hex"fa0bd2c3"; // Arbitrary, e.g. an RLP list header.
        bytes memory suffix = hex"05";
        _assertRelays(prefix, chunks, suffix, abi.encodePacked(prefix, body, suffix));

        // Empty prefix and suffix.
        _assertRelays("", chunks, "", body);
        // Empty prefix only and empty suffix only.
        _assertRelays("", chunks, suffix, abi.encodePacked(body, suffix));
        _assertRelays(prefix, chunks, "", abi.encodePacked(prefix, body));
        assertEq(recorder.calls(), 4);
    }

    function test_RelayReusedChunkAndNoChunks() public {
        bytes memory piece = _randomBytes(5, 100);
        address pointer = relayer.storeChunk(piece);
        address[] memory chunks = new address[](3);
        chunks[0] = pointer;
        chunks[1] = pointer;
        chunks[2] = pointer;
        _assertRelays(hex"01", chunks, hex"02", abi.encodePacked(hex"01", piece, piece, piece, hex"02"));

        address[] memory none = new address[](0);
        _assertRelays(hex"aabb", none, hex"cc", hex"aabbcc");
        _assertRelays("", none, "", "");
    }

    function testFuzz_RelayRandomSplits(
        uint256 seed,
        uint256 length,
        bytes memory prefix,
        bytes memory suffix
    ) public {
        length = bound(length, 0, 60_000);
        bytes memory body = _randomBytes(seed, length);

        // Random split sizes in [1, MAX], biased towards small pieces half of the time.
        uint256[] memory sizes = new uint256[](length);
        uint256 n;
        uint256 remaining = length;
        while (remaining > 0) {
            uint256 r = uint256(keccak256(abi.encode(seed, n, "split")));
            uint256 cap = r % 2 == 0 ? 64 : MAX;
            uint256 size = 1 + ((r >> 8) % cap);
            if (size > remaining) size = remaining;
            sizes[n++] = size;
            remaining -= size;
        }
        assembly {
            mstore(sizes, n)
        }

        address[] memory chunks = _storeSplit(body, sizes);
        _assertRelays(prefix, chunks, suffix, abi.encodePacked(prefix, body, suffix));
    }

    function test_RelayBubblesRevertReason() public {
        RevertingRootTunnel reverting = new RevertingRootTunnel();
        RootTunnelChunkedRelayer r = new RootTunnelChunkedRelayer(address(reverting));
        address[] memory chunks = new address[](1);
        chunks[0] = r.storeChunk(_randomBytes(6, 5000));

        vm.expectRevert(bytes("FxRootTunnel: EXIT_ALREADY_PROCESSED"));
        r.relay(hex"01", chunks, hex"02");

        // Raw revert data is passed through verbatim (custom errors too).
        (bool success, bytes memory ret) = address(r).call(abi.encodeCall(r.relay, (hex"01", chunks, hex"02")));
        assertFalse(success);
        assertEq(ret, abi.encodeWithSignature("Error(string)", "FxRootTunnel: EXIT_ALREADY_PROCESSED"));

        reverting.setUseCustomError(true);
        vm.expectRevert(abi.encodeWithSignature("CustomFailure(uint256)", uint256(42)));
        r.relay(hex"01", chunks, hex"02");
    }

    function test_RelayRevertsOnMissingChunk() public {
        address[] memory chunks = new address[](2);
        chunks[0] = relayer.storeChunk(_randomBytes(7, 100));
        chunks[1] = relayer.chunkAddress(_randomBytes(8, 100)); // Predicted but never stored.
        vm.expectRevert(bytes("Missing chunk"));
        relayer.relay("", chunks, "");

        // A contract whose code is just the 0x00 prefix (no data) is rejected too.
        chunks[1] = address(0x1234);
        vm.etch(chunks[1], hex"00");
        vm.expectRevert(bytes("Missing chunk"));
        relayer.relay("", chunks, "");
        assertEq(recorder.calls(), 0);
    }

    /****************************************
     *               GAS TESTS              *
     ****************************************/

    function _relayGas(uint256 size, uint256 seed) internal returns (uint256 execGas, uint256 txGas) {
        bytes memory payload = _randomBytes(seed, size);
        bytes memory prefix = _slice(payload, 0, 4);
        bytes memory suffix = _slice(payload, size - 2, 2);
        address[] memory chunks = _storeFull(_slice(payload, 4, size - 6));
        relayer.relay(prefix, chunks, suffix);
        execGas = _lastCallGasUsed();
        (uint256 standard, uint256 floor) = _calldataGas(abi.encodeCall(relayer.relay, (prefix, chunks, suffix)));
        txGas = standard + execGas > floor ? standard + execGas : floor;

        assertEq(recorder.lastHash(), keccak256(payload));
        assertLt(txGas, EIP7825_TX_GAS_CAP);
        emit log_named_uint("relay (mock) chunks", chunks.length);
    }

    function test_GasStoreChunkFull() public {
        bytes memory data = _randomBytes(9, MAX);
        relayer.storeChunk(data);
        uint256 execGas = _lastCallGasUsed();
        (uint256 standard, uint256 floor) = _calldataGas(abi.encodeCall(relayer.storeChunk, (data)));
        uint256 txGas = standard + execGas > floor ? standard + execGas : floor;
        emit log_named_uint("storeChunk(24575 bytes) execution gas", execGas);
        emit log_named_uint("storeChunk(24575 bytes) approx tx gas", txGas);
        assertLt(txGas, EIP7825_TX_GAS_CAP);
    }

    function test_GasRelayMock() public {
        (uint256 e1, uint256 t1) = _relayGas(134 * 1024, 10);
        emit log_named_uint("relay 134 KiB (mock) execution gas", e1);
        emit log_named_uint("relay 134 KiB (mock) approx tx gas", t1);
        (uint256 e2, uint256 t2) = _relayGas(220 * 1024, 11);
        emit log_named_uint("relay 220 KiB (mock) execution gas", e2);
        emit log_named_uint("relay 220 KiB (mock) approx tx gas", t2);
        (uint256 e3, uint256 t3) = _relayGas(520 * 1024, 12);
        emit log_named_uint("relay 520 KiB (mock) execution gas", e3);
        emit log_named_uint("relay 520 KiB (mock) approx tx gas", t3);
    }
}

/**
 * @notice End-to-end tests against the real OracleRootTunnel with a synthetic but valid exit proof: a single-leaf
 * receipt trie and a single-block checkpoint, with the receipt padded by filler logs to reach large payload sizes.
 */
contract RootTunnelChunkedRelayerOracleRootTunnelTest is RootTunnelChunkedRelayerTestBase {
    bytes32 constant SEND_MESSAGE_EVENT_SIG = 0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036;
    address constant CHILD_TUNNEL = address(0xC41D);
    uint256 constant HEADER_NUMBER = 10000;
    uint256 constant BLOCK_NUMBER = 123456;
    uint256 constant BLOCK_TIME = 1700000000;
    bytes constant BRANCH_MASK = hex"2080"; // HP-encoded even leaf path for receipt key rlp(0) = 0x80.

    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData, bytes32 indexed requestHash);

    OracleRootTunnel tunnel;
    CheckpointManagerMock checkpointManager;
    OracleMock oracle;

    struct Exit {
        bytes prefix;
        bytes body; // First 9 RLP items.
        bytes suffix; // Log index item.
        bytes payload;
    }

    function setUp() public {
        checkpointManager = new CheckpointManagerMock();
        oracle = new OracleMock();
        FinderMock finder = new FinderMock(address(oracle));
        tunnel = new OracleRootTunnel(address(checkpointManager), address(0xF0), address(finder));
        tunnel.setFxChildTunnel(CHILD_TUNNEL);
        relayer = new RootTunnelChunkedRelayer(address(tunnel));
    }

    function _log(
        address emitter,
        bytes32 topic0,
        bytes memory data
    ) internal pure returns (bytes memory) {
        bytes[] memory topics = new bytes[](1);
        topics[0] = _rlpBytes(abi.encodePacked(topic0));
        bytes[] memory fields = new bytes[](3);
        fields[0] = _rlpBytes(abi.encodePacked(emitter));
        fields[1] = _rlpList(topics);
        fields[2] = _rlpBytes(data);
        return _rlpList(fields);
    }

    // Builds a valid exit payload whose receipt has `fillerLogs` filler logs of `fillerSize` data bytes followed by the
    // MessageSent log of the child tunnel carrying a price request.
    function _buildExit(
        uint256 fillerLogs,
        uint256 fillerSize,
        bytes memory ancillaryData
    ) internal returns (Exit memory exit) {
        bytes memory message = abi.encode(bytes32("YES_OR_NO_QUERY"), uint256(BLOCK_TIME), ancillaryData);
        bytes[] memory logs = new bytes[](fillerLogs + 1);
        bytes memory filler = _log(address(0xF111), keccak256("Filler()"), _randomBytes(77, fillerSize));
        for (uint256 i = 0; i < fillerLogs; i++) logs[i] = filler;
        logs[fillerLogs] = _log(CHILD_TUNNEL, SEND_MESSAGE_EVENT_SIG, abi.encode(message));

        bytes[] memory receiptFields = new bytes[](4);
        receiptFields[0] = _rlpUint(1);
        receiptFields[1] = _rlpUint(21000);
        receiptFields[2] = _rlpBytes(new bytes(256));
        receiptFields[3] = _rlpList(logs);
        bytes memory receipt = _rlpList(receiptFields);

        // Single-leaf receipt trie and a proof containing only that leaf.
        bytes memory leaf = _rlpList2(_rlpBytes(BRANCH_MASK), _rlpBytes(receipt));
        bytes32 receiptRoot = keccak256(leaf);
        bytes[] memory proofNodes = new bytes[](1);
        proofNodes[0] = leaf;
        bytes memory receiptProof = _rlpList(proofNodes);

        bytes32 txRoot = keccak256("txRoot");
        // Checkpoint with a single block: empty block proof, root = leaf hash.
        checkpointManager.setHeaderBlock(
            HEADER_NUMBER,
            keccak256(abi.encodePacked(BLOCK_NUMBER, BLOCK_TIME, txRoot, receiptRoot)),
            BLOCK_NUMBER,
            BLOCK_NUMBER
        );

        bytes[] memory items = new bytes[](9);
        items[0] = _rlpUint(HEADER_NUMBER);
        items[1] = _rlpBytes("");
        items[2] = _rlpUint(BLOCK_NUMBER);
        items[3] = _rlpUint(BLOCK_TIME);
        items[4] = _rlpBytes(abi.encodePacked(txRoot));
        items[5] = _rlpBytes(abi.encodePacked(receiptRoot));
        items[6] = _rlpBytes(receipt);
        items[7] = _rlpBytes(receiptProof);
        items[8] = _rlpBytes(BRANCH_MASK);
        exit.body = _concat(items);
        exit.suffix = _rlpUint(fillerLogs);
        exit.prefix = _rlpHeader(exit.body.length + exit.suffix.length, 0xc0);
        exit.payload = abi.encodePacked(exit.prefix, exit.body, exit.suffix);
    }

    function test_RealTunnelDirectAndRelayedAreEquivalent() public {
        Exit memory exit = _buildExit(2, 30_000, "q: title: Will it work?");
        assertGt(exit.payload.length, 2 * MAX);

        // Sanity check: the synthetic proof is accepted when submitted directly.
        uint256 snapshot = vm.snapshotState();
        tunnel.receiveMessage(exit.payload);
        assertEq(oracle.requests(), 1);
        vm.revertToState(snapshot);

        address[] memory chunks = _storeFull(exit.body);
        bytes memory ancillaryData = "q: title: Will it work?";
        vm.expectEmit(true, true, false, true, address(tunnel));
        emit PriceRequestAdded(
            bytes32("YES_OR_NO_QUERY"),
            BLOCK_TIME,
            ancillaryData,
            keccak256(abi.encode(bytes32("YES_OR_NO_QUERY"), uint256(BLOCK_TIME), ancillaryData))
        );
        vm.expectEmit(true, false, false, true, address(relayer));
        emit MessageRelayed(keccak256(exit.payload));
        relayer.relay(exit.prefix, chunks, exit.suffix);
        assertEq(oracle.requests(), 1);

        // Replays revert with the root tunnel's reason, both via the relayer and directly.
        vm.expectRevert(bytes("FxRootTunnel: EXIT_ALREADY_PROCESSED"));
        relayer.relay(exit.prefix, chunks, exit.suffix);
        vm.expectRevert(bytes("FxRootTunnel: EXIT_ALREADY_PROCESSED"));
        tunnel.receiveMessage(exit.payload);
    }

    function test_RealTunnelRejectsBadProof() public {
        Exit memory exit = _buildExit(3, 20_000, "q: bad proof");
        // Flip a byte deep inside the receipt (filler log data in the second chunk): the RLP structure stays valid
        // but the receipt no longer matches the receipt trie root.
        bytes memory tampered = _slice(exit.body, 0, exit.body.length);
        uint256 index = MAX + 100;
        tampered[index] = bytes1(uint8(tampered[index]) ^ 0x01);
        address[] memory chunks = _storeFull(tampered);
        vm.expectRevert(bytes("FxRootTunnel: INVALID_RECEIPT_PROOF"));
        relayer.relay(exit.prefix, chunks, exit.suffix);

        // Wrong log index points at a filler log not emitted by the child tunnel.
        chunks = _storeFull(exit.body);
        vm.expectRevert(bytes("FxRootTunnel: INVALID_FX_CHILD_TUNNEL"));
        relayer.relay(exit.prefix, chunks, _rlpUint(0));

        // Chunks out of order produce an invalid payload.
        address tmp = chunks[0];
        chunks[0] = chunks[1];
        chunks[1] = tmp;
        vm.expectRevert();
        relayer.relay(exit.prefix, chunks, exit.suffix);
        assertEq(oracle.requests(), 0);

        // The untampered payload still goes through after the failed attempts.
        chunks[1] = chunks[0];
        chunks[0] = tmp;
        relayer.relay(exit.prefix, chunks, exit.suffix);
        assertEq(oracle.requests(), 1);
    }

    function _realRelayGas(uint256 targetSize, string memory label) internal {
        // Each filler log with 4000 data bytes encodes to ~4074 bytes and the receipt appears twice in the payload
        // (as item 6 and inside the receipt proof leaf), as in real Polygon exit payloads.
        uint256 fillerLogs = targetSize / (2 * 4074);
        Exit memory exit = _buildExit(fillerLogs, 4000, "q: title: gas test");
        address[] memory chunks = _storeFull(exit.body);

        // Reference: the same payload submitted directly to the root tunnel (single tx).
        uint256 snapshot = vm.snapshotState();
        tunnel.receiveMessage(exit.payload);
        uint256 directExecGas = _lastCallGasUsed();
        vm.revertToState(snapshot);
        (uint256 directStandard, uint256 directFloor) =
            _calldataGas(abi.encodeCall(tunnel.receiveMessage, (exit.payload)));
        uint256 directTxGas =
            directStandard + directExecGas > directFloor ? directStandard + directExecGas : directFloor;
        emit log_named_uint(string(abi.encodePacked(label, " direct receiveMessage execution gas")), directExecGas);
        emit log_named_uint(string(abi.encodePacked(label, " direct receiveMessage approx tx gas")), directTxGas);
        relayer.relay(exit.prefix, chunks, exit.suffix);
        uint256 execGas = _lastCallGasUsed();
        (uint256 standard, uint256 floor) =
            _calldataGas(abi.encodeCall(relayer.relay, (exit.prefix, chunks, exit.suffix)));
        uint256 txGas = standard + execGas > floor ? standard + execGas : floor;

        assertEq(oracle.requests(), 1);
        assertLt(txGas, EIP7825_TX_GAS_CAP);
        emit log_named_uint(string(abi.encodePacked(label, " payload bytes")), exit.payload.length);
        emit log_named_uint(string(abi.encodePacked(label, " chunks")), chunks.length);
        emit log_named_uint(string(abi.encodePacked(label, " execution gas")), execGas);
        emit log_named_uint(string(abi.encodePacked(label, " approx tx gas")), txGas);
    }

    function test_GasRealTunnel134KiB() public {
        _realRelayGas(134 * 1024, "relay real tunnel 134 KiB");
    }

    function test_GasRealTunnel220KiB() public {
        _realRelayGas(220 * 1024, "relay real tunnel 220 KiB");
    }

    function test_GasRealTunnel520KiB() public {
        _realRelayGas(520 * 1024, "relay real tunnel 520 KiB");
    }
}
