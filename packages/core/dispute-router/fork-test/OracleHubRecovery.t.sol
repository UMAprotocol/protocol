// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { DisputeRouter } from "../src/DisputeRouter.sol";
import { FinderInterface } from "@uma/core/data-verification-mechanism/interfaces/FinderInterface.sol";
import {
    OracleAncillaryInterface
} from "@uma/core/data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";

interface RecoveryRegistry {
    function getMember(uint256 role) external view returns (address);
    function addMember(uint256 role, address member) external;
    function registerContract(address[] calldata parties, address contractAddress) external;
}

interface RecoveryChild {
    function fxChild() external view returns (address);
    function fxRootTunnel() external view returns (address);
    function childRequestIds(bytes32 parentRequestId) external view returns (bytes32);
}

interface RecoveryHub {
    function token() external view returns (IERC20);
    function requestPrice(bytes32 identifier, uint256 time, bytes calldata ancillaryData) external;
}

interface RecoveryRoot {
    function finder() external view returns (FinderInterface);
    function fxRoot() external view returns (address);
    function publishPrice(bytes32 identifier, uint256 time, bytes calldata ancillaryData) external;
}

interface RecoveryStore {
    function computeFinalFee(address currency) external view returns (uint256 rawValue);
}

interface RecoveryFxRoot {
    function stateSender() external view returns (address);
    function fxChild() external view returns (address);
}

interface RecoveryFxChild {
    function onStateReceive(uint256 stateId, bytes calldata data) external;
}

/// @dev Real deployed Hub, DVM admission, tunnels and Fx contracts run on pinned forks.
/// DVM getPrice is mocked after admission; state-sync delivery impersonates Polygon's system caller.
/// The outbound Polygon message is deliberately not relayed, modeling an unavailable transport.
contract OracleHubRecoveryForkTest is Test {
    uint256 internal constant MAINNET_BLOCK = 26_430_000;
    uint256 internal constant POLYGON_BLOCK = 97_470_000;
    uint64 internal constant FORWARD_DELAY = 1 hours;
    bytes32 internal constant IDENTIFIER = "YES_OR_NO_QUERY";
    uint256 internal constant REQUEST_TIME = 1_700_000_000;
    int256 internal constant PRICE = 1e18;
    address internal constant CHILD = 0xac60353a54873c446101216829a6A98cDbbC3f3D;
    address internal constant ROOT = 0x9B40E25dDd4518F36c50ce8AEf53Ee527419D55d;
    address internal constant HUB = 0x8fE658AeB8d55fd1F3E157Ff8B316E232ffFF372;
    address internal constant POLYGON_FINDER = 0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64;
    address internal constant SYSTEM = 0x0000000000000000000000000000000000001001;
    bytes32 internal constant PRICE_REQUEST_ADDED = keccak256("PriceRequestAdded(bytes32,uint256,bytes,bytes32)");
    bytes32 internal constant REQUEST_ADDED = keccak256("RequestAdded(address,uint32,bytes32,uint256,bytes,bool)");
    bytes32 internal constant STATE_SYNCED = keccak256("StateSynced(uint256,address,bytes)");

    uint256 internal mainnetFork;
    uint256 internal polygonFork;
    DisputeRouter internal router;
    bytes internal originalData = "question:dispute-router-oraclehub-recovery-fork-test";
    bytes internal parentData;
    address internal council = address(0xCAFE);
    uint64 internal forwardedAt;

    function setUp() public {
        mainnetFork = vm.createFork(vm.envString("MAINNET_RPC_URL"), MAINNET_BLOCK);
        polygonFork = vm.createSelectFork(vm.envString("POLYGON_RPC_URL"), POLYGON_BLOCK);
        FinderInterface finder = FinderInterface(POLYGON_FINDER);
        DisputeRouter implementation = new DisputeRouter(finder, OracleAncillaryInterface(CHILD));
        router = DisputeRouter(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        DisputeRouter.initialize,
                        (OracleAncillaryInterface(CHILD), council, FORWARD_DELAY, address(this))
                    )
                )
            )
        );
        RecoveryRegistry registry = RecoveryRegistry(finder.getImplementationAddress("Registry"));
        vm.prank(registry.getMember(0));
        registry.addMember(1, address(this));
        registry.registerContract(new address[](0), address(this));
        registry.registerContract(new address[](0), address(router));
        assertEq(RecoveryChild(CHILD).fxRootTunnel(), ROOT);
    }

    function test_RecoverUndeliveredForwardViaOracleHub() public {
        _forwardWithoutRelay();
        vm.selectFork(mainnetFork);
        RecoveryRoot root = RecoveryRoot(ROOT);
        address dvm = root.finder().getImplementationAddress("Oracle");
        _requestThroughHub(root.finder(), dvm);

        // Voting is outside this recovery regression; supply only the admitted request's answer.
        vm.mockCall(
            dvm,
            abi.encodeCall(OracleAncillaryInterface.getPrice, (IDENTIFIER, REQUEST_TIME, parentData)),
            abi.encode(PRICE)
        );
        vm.recordLogs();
        root.publishPrice(IDENTIFIER, REQUEST_TIME, parentData);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        address fxChild = RecoveryFxRoot(root.fxRoot()).fxChild();
        address stateSender = RecoveryFxRoot(root.fxRoot()).stateSender();
        (uint256 stateId, bytes memory message) = _stateSync(logs, stateSender, fxChild);
        (address sender, address receiver, bytes memory payload) = abi.decode(message, (address, address, bytes));
        assertEq(sender, ROOT);
        assertEq(receiver, CHILD);
        assertEq(payload, abi.encode(IDENTIFIER, REQUEST_TIME, parentData, PRICE));

        vm.selectFork(polygonFork);
        assertEq(RecoveryChild(CHILD).fxChild(), fxChild);
        assertFalse(router.hasPrice(IDENTIFIER, REQUEST_TIME, originalData));
        vm.expectRevert();
        RecoveryFxChild(fxChild).onStateReceive(stateId, message);
        vm.prank(SYSTEM);
        RecoveryFxChild(fxChild).onStateReceive(stateId, message);
        assertTrue(router.hasPrice(IDENTIFIER, REQUEST_TIME, originalData));
        assertEq(router.getPrice(IDENTIFIER, REQUEST_TIME, originalData), PRICE);
        (, uint64 timestamp, bool locallyResolved,) = router.priceRequests(_childId());
        assertEq(timestamp, forwardedAt);
        assertFalse(locallyResolved, "Recovery uses the DVM answer without resetting forwarding");
    }

    function _requestThroughHub(FinderInterface finder, address dvm) internal {
        address store = finder.getImplementationAddress("Store");
        IERC20 token = RecoveryHub(HUB).token();
        uint256 fee = RecoveryStore(store).computeFinalFee(address(token));
        deal(address(token), address(this), fee);
        token.approve(HUB, fee);
        uint256 storeBalance = token.balanceOf(store);
        vm.expectRevert();
        RecoveryRoot(ROOT).publishPrice(IDENTIFIER, REQUEST_TIME, parentData);
        vm.recordLogs();
        RecoveryHub(HUB).requestPrice(IDENTIFIER, REQUEST_TIME, parentData);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool admitted;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == dvm && logs[i].topics[0] == REQUEST_ADDED) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), HUB);
                assertEq(logs[i].topics[3], IDENTIFIER);
                (uint256 time, bytes memory data, bool governance) = abi.decode(logs[i].data, (uint256, bytes, bool));
                assertEq(time, REQUEST_TIME);
                assertEq(data, parentData);
                assertFalse(governance);
                admitted = true;
            }
        }
        assertTrue(admitted, "Real DVM must admit the exact compressed request from OracleHub");
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.balanceOf(store), storeBalance + fee);
        vm.expectRevert();
        RecoveryRoot(ROOT).publishPrice(IDENTIFIER, REQUEST_TIME, parentData);
    }

    function _forwardWithoutRelay() internal {
        router.requestPrice(IDENTIFIER, REQUEST_TIME, originalData);
        vm.warp(block.timestamp + FORWARD_DELAY);
        vm.recordLogs();
        vm.prank(address(0xBEEF));
        router.forwardPriceRequest(IDENTIFIER, REQUEST_TIME, originalData);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == CHILD && logs[i].topics[0] == PRICE_REQUEST_ADDED) {
                assertEq(logs[i].topics[1], IDENTIFIER);
                (uint256 time, bytes memory data) = abi.decode(logs[i].data, (uint256, bytes));
                assertEq(time, REQUEST_TIME);
                parentData = data;
                assertEq(logs[i].topics[2], keccak256(abi.encode(IDENTIFIER, REQUEST_TIME, data)));
                assertEq(RecoveryChild(CHILD).childRequestIds(logs[i].topics[2]), _childId());
                found = true;
            }
        }
        assertTrue(found, "Extract compressed data from the real PriceRequestAdded event");
        assertNotEq(keccak256(parentData), keccak256(originalData));
        (, forwardedAt,,) = router.priceRequests(_childId());
        assertGt(forwardedAt, 0);
        assertFalse(router.hasPrice(IDENTIFIER, REQUEST_TIME, originalData));
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.CannotResolveAfterForwarding.selector, _childId()));
        vm.prank(council);
        router.resolvePriceRequest(IDENTIFIER, REQUEST_TIME, originalData, PRICE);
        vm.expectRevert();
        router.forwardPriceRequest(IDENTIFIER, REQUEST_TIME, originalData);
        // Deliberately omit the Polygon-to-Ethereum relay to model an unavailable bridge transport.
    }

    function _stateSync(
        Vm.Log[] memory logs,
        address stateSender,
        address fxChild
    )
        internal
        pure
        returns (uint256 stateId, bytes memory message)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == stateSender && logs[i].topics[0] == STATE_SYNCED) {
                require(address(uint160(uint256(logs[i].topics[2]))) == fxChild, "Wrong state sync destination");
                return (uint256(logs[i].topics[1]), abi.decode(logs[i].data, (bytes)));
            }
        }
        revert("Missing real StateSynced event");
    }

    function _childId() internal view returns (bytes32) {
        return keccak256(abi.encode(IDENTIFIER, REQUEST_TIME, originalData));
    }
}
