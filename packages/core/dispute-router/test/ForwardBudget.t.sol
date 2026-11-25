// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { DisputeRouter } from "../src/DisputeRouter.sol";
import { MockFinder, MockRegistry, TestableOracleChildTunnel } from "./DisputeRouter.t.sol";
import { FinderInterface } from "@uma/core/data-verification-mechanism/interfaces/FinderInterface.sol";
import {
    OracleAncillaryInterface
} from "@uma/core/data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";

contract BudgetOracle is OracleAncillaryInterface {
    bool public fail;
    bool public tryReentry;
    bool public reentrySucceeded;
    uint256 public calls;
    DisputeRouter public router;

    function configure(DisputeRouter target, bool shouldFail, bool reenter) external {
        router = target;
        fail = shouldFail;
        tryReentry = reenter;
    }

    function requestPrice(bytes32 identifier, uint256 time, bytes memory ancillaryData) public override {
        require(!fail, "Oracle failure");
        calls++;
        if (tryReentry) {
            (reentrySucceeded,) = address(router)
                .call(abi.encodeCall(DisputeRouter.forwardPriceRequest, (identifier, time + 1, ancillaryData)));
        }
    }

    function hasPrice(bytes32, uint256, bytes memory) public pure override returns (bool) {
        return false;
    }

    function getPrice(bytes32, uint256, bytes memory) public pure override returns (int256) {
        revert("No price");
    }
}

contract ForwardBudgetTest is Test {
    event RequestDeferred(bytes32 indexed requestId);
    DisputeRouter internal router;
    MockFinder internal finder;
    MockRegistry internal registry;
    TestableOracleChildTunnel internal oracle;
    address internal owner = address(0xBEEF);
    address internal council = address(0xCAFE);
    address internal requester = address(0xA11CE);
    bytes32 internal constant IDENTIFIER = "TEST";
    uint64 internal constant DELAY = 60;

    function setUp() public {
        vm.warp(1000);
        vm.roll(100);
        registry = new MockRegistry();
        finder = new MockFinder(address(registry));
        oracle = new TestableOracleChildTunnel(address(finder));
        DisputeRouter implementation =
            new DisputeRouter(FinderInterface(address(finder)), OracleAncillaryInterface(address(0)));
        router = DisputeRouter(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        DisputeRouter.initialize, (OracleAncillaryInterface(address(oracle)), council, DELAY, owner)
                    )
                )
            )
        );
        registry.registerContract(requester);
        oracle.registerContract(address(router));
    }

    function _request(uint256 time, bytes memory data) internal {
        vm.prank(requester);
        router.requestPrice(IDENTIFIER, time, data);
    }

    function _ready() internal {
        vm.warp(block.timestamp + DELAY + 1);
    }

    function _expectBudgetFailure(uint256 time, bytes memory data) internal {
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.ForwardBudgetExceeded.selector, block.number));
        router.forwardPriceRequest(IDENTIFIER, time, data);
    }

    function _assertUsage(uint32 count) internal view {
        (, uint32 actualCount) = router.forwardBudget();
        assertEq(actualCount, count);
    }

    function test_DefaultsAreActiveWithoutAnyBudgetInitializer() public view {
        (uint32 count, uint32 used) = router.forwardBudget();
        assertEq(count, 1);
        assertEq(used, 0);
    }

    function test_AllCallersShareOneBudgetAndPendingRequestCanRetryNextBlock() public {
        _request(1, "a");
        _request(2, "b");
        _ready();
        vm.prank(address(123));
        router.forwardPriceRequest(IDENTIFIER, 1, "a");
        _expectBudgetFailure(2, "b");
        vm.roll(block.number + 1);
        _assertUsage(0);
        vm.prank(address(456));
        router.forwardPriceRequest(IDENTIFIER, 2, "b");
        assertEq(oracle.requestCount(), 2);
        _assertUsage(1);
    }

    function test_26ReadyRequestsCannotBeForwardedInOneBatchEvenWithCaughtReverts() public {
        for (uint256 i = 1; i <= 26; i++) {
            _request(i, "");
        }
        _ready();
        uint256 successes;
        for (uint256 i = 1; i <= 26; i++) {
            vm.prank(address(uint160(100 + i)));
            try router.forwardPriceRequest(IDENTIFIER, i, "") {
                successes++;
            } catch { }
        }
        assertEq(successes, 1);
        assertEq(oracle.requestCount(), 1);
        _assertUsage(1);
    }

    function test_PassthroughDefers25ButAdmitsAll26Disputes() public {
        vm.prank(owner);
        router.setForwardDelay(0);
        for (uint256 i = 1; i <= 26; i++) {
            _request(i, "");
            (uint64 admitted, uint64 forwarded,,) =
                router.priceRequests(keccak256(abi.encode(IDENTIFIER, i, bytes(""))));
            assertGt(admitted, 0);
            if (i == 1) assertGt(forwarded, 0);
            else assertEq(forwarded, 0);
        }
        assertEq(oracle.requestCount(), 1);
        _expectBudgetFailure(2, "");
        vm.roll(block.number + 1);
        router.forwardPriceRequest(IDENTIFIER, 2, "");
        assertEq(oracle.requestCount(), 2);
    }

    function test_IdempotentAdmissionsDoNotConsumeAgain() public {
        vm.prank(owner);
        router.setForwardDelay(0);
        _request(1, "a");
        _request(1, "a");
        _assertUsage(1);
        assertEq(oracle.requestCount(), 1);
    }

    function test_PassthroughDeferralEmitsRecoverableRequestId() public {
        vm.prank(owner);
        router.setForwardDelay(0);
        _request(1, "a");
        vm.expectEmit(true, false, false, true, address(router));
        emit RequestDeferred(keccak256(abi.encode(IDENTIFIER, uint256(2), bytes("b"))));
        _request(2, "b");
    }

    function test_BudgetDoesNotAllowUnregisteredAdmissions() public {
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.CallerNotRegistered.selector, address(this)));
        router.requestPrice(IDENTIFIER, 1, "");
        _assertUsage(0);
    }

    function test_CouncilAndPublicForwardingShareBudget() public {
        _request(1, "a");
        _request(2, "b");
        vm.prank(council);
        router.escalateNow(IDENTIFIER, 1, "a");
        _ready();
        _expectBudgetFailure(2, "b");
        vm.prank(council);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.ForwardBudgetExceeded.selector, block.number));
        router.escalateNow(IDENTIFIER, 2, "b");
        vm.roll(block.number + 1);
        vm.prank(council);
        router.escalateNow(IDENTIFIER, 2, "b");
        assertEq(oracle.requestCount(), 2);
    }

    function test_PassthroughAndEscalationShareBudget() public {
        _request(2, "b");
        vm.prank(owner);
        router.setForwardDelay(0);
        _request(1, "a");
        vm.prank(council);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.ForwardBudgetExceeded.selector, block.number));
        router.escalateNow(IDENTIFIER, 2, "b");
        _assertUsage(1);
    }

    function test_RaisedCallLimitAllowsMultipleLargeForwards() public {
        vm.prank(owner);
        router.setForwardBudget(2);
        bytes memory exact = new bytes(16_384);
        _request(1, exact);
        _request(2, exact);
        _request(3, "");
        _ready();
        router.forwardPriceRequest(IDENTIFIER, 1, exact);
        router.forwardPriceRequest(IDENTIFIER, 2, exact);
        _expectBudgetFailure(3, "");
        assertEq(oracle.requestCount(), 2);
        _assertUsage(2);
    }

    function test_PassthroughCountsCallsRegardlessOfAncillarySize() public {
        bytes memory over = new bytes(8193);
        vm.prank(owner);
        router.setForwardDelay(0);
        _request(1, over);
        _assertUsage(1);
        _request(2, "");
        _assertUsage(1);
        assertEq(oracle.requestCount(), 1);
        vm.roll(block.number + 1);
        router.forwardPriceRequest(IDENTIFIER, 2, "");
        assertEq(oracle.requestCount(), 2);
        _assertUsage(1);
    }

    function test_LimitSetterCannotDisableOrBeCalledByNonOwner() public {
        vm.expectRevert();
        router.setForwardBudget(100);
        vm.startPrank(owner);
        vm.expectRevert(DisputeRouter.InvalidForwardBudget.selector);
        router.setForwardBudget(0);
        vm.stopPrank();
    }

    function test_PublicAndCouncilForwardingDoNotImposeAncillarySizeLimit() public {
        bytes memory over = new bytes(8193);
        _request(1, over);
        _request(2, over);
        _ready();
        router.forwardPriceRequest(IDENTIFIER, 1, over);
        _expectBudgetFailure(2, over);
        vm.roll(block.number + 1);
        vm.prank(council);
        router.escalateNow(IDENTIFIER, 2, over);
        assertEq(oracle.requestCount(), 2);
        _assertUsage(1);
    }

    function test_ConfigurationChangesDoNotResetUsage() public {
        _request(1, "a");
        _request(2, "b");
        _ready();
        router.forwardPriceRequest(IDENTIFIER, 1, "a");
        vm.startPrank(owner);
        router.setForwardBudget(1);
        router.setForwardDelay(0);
        router.setCouncil(address(123));
        router.setOracle(address(oracle));
        vm.stopPrank();
        _expectBudgetFailure(2, "b");
        _assertUsage(1);
    }

    function test_LoweringLimitsBelowSpentUsageDoesNotUnderflowOrAllowMore() public {
        vm.prank(owner);
        router.setForwardBudget(5);
        _request(1, "aaa");
        _request(2, "bbb");
        _request(3, "ccc");
        _ready();
        router.forwardPriceRequest(IDENTIFIER, 1, "aaa");
        router.forwardPriceRequest(IDENTIFIER, 2, "bbb");
        vm.prank(owner);
        router.setForwardBudget(1);
        _expectBudgetFailure(3, "ccc");
        _assertUsage(2);
        vm.roll(block.number + 1);
        router.forwardPriceRequest(IDENTIFIER, 3, "ccc");
        _assertUsage(1);
    }

    function test_OracleRevertRollsBackBudgetAndForwardedMark() public {
        BudgetOracle failing = new BudgetOracle();
        failing.configure(router, true, false);
        vm.prank(owner);
        router.setOracle(address(failing));
        _request(1, "a");
        _ready();
        vm.expectRevert("Oracle failure");
        router.forwardPriceRequest(IDENTIFIER, 1, "a");
        _assertUsage(0);
        (, uint64 forwarded,,) = router.priceRequests(keccak256(abi.encode(IDENTIFIER, uint256(1), bytes("a"))));
        assertEq(forwarded, 0);
        vm.prank(owner);
        router.setOracle(address(oracle));
        router.forwardPriceRequest(IDENTIFIER, 1, "a");
        assertEq(oracle.requestCount(), 1);
    }

    function test_OracleReentryCannotForwardAnotherRequest() public {
        BudgetOracle reentrantOracle = new BudgetOracle();
        reentrantOracle.configure(router, false, true);
        vm.prank(owner);
        router.setOracle(address(reentrantOracle));
        _request(1, "");
        _request(2, "");
        _ready();
        router.forwardPriceRequest(IDENTIFIER, 1, "");
        assertFalse(reentrantOracle.reentrySucceeded());
        assertEq(reentrantOracle.calls(), 1);
        _assertUsage(1);
    }

    function test_LocalCouncilResolutionAndPriceReadsStillWorkWhenSaturated() public {
        _request(1, "a");
        _request(2, "b");
        _ready();
        router.forwardPriceRequest(IDENTIFIER, 1, "a");
        vm.prank(council);
        router.resolvePriceRequest(IDENTIFIER, 2, "b", 42);
        vm.startPrank(requester);
        assertTrue(router.hasPrice(IDENTIFIER, 2, "b"));
        assertEq(router.getPrice(IDENTIFIER, 2, "b"), 42);
        vm.stopPrank();
        _assertUsage(1);
    }

    function test_ForwardedPriceReadsStillWorkWhenSaturated() public {
        _request(1, "a");
        _ready();
        router.forwardPriceRequest(IDENTIFIER, 1, "a");
        oracle.resolvePrice(IDENTIFIER, 1, "a", 42);
        vm.startPrank(requester);
        assertTrue(router.hasPrice(IDENTIFIER, 1, "a"));
        assertEq(router.getPrice(IDENTIFIER, 1, "a"), 42);
        vm.stopPrank();
        _assertUsage(1);
    }

    function test_UpgradePreservesConsumedBudgetAndExistingRequests() public {
        _request(1, "a");
        _request(2, "b");
        _ready();
        router.forwardPriceRequest(IDENTIFIER, 1, "a");
        DisputeRouter replacement =
            new DisputeRouter(FinderInterface(address(finder)), OracleAncillaryInterface(address(0)));
        vm.prank(owner);
        router.upgradeToAndCall(address(replacement), "");
        _expectBudgetFailure(2, "b");
        _assertUsage(1);
        vm.roll(block.number + 1);
        router.forwardPriceRequest(IDENTIFIER, 2, "b");
        assertEq(oracle.requestCount(), 2);
    }

    function test_BlockZeroAndLargeBlockNumbersCannotBypassBudget() public {
        _request(1, "");
        _request(2, "");
        _ready();
        vm.roll(0);
        router.forwardPriceRequest(IDENTIFIER, 1, "");
        _expectBudgetFailure(2, "");
        vm.roll(uint256(type(uint64).max) + 1);
        router.forwardPriceRequest(IDENTIFIER, 2, "");
        _assertUsage(1);
    }

    function testFuzz_MixedPathsAndCallersCannotExceedBudget(uint8 countSeed, uint256 seed) public {
        uint32 maxCount = uint32(bound(countSeed, 1, 8));
        vm.prank(owner);
        router.setForwardBudget(maxCount);
        uint32 expectedCount;
        for (uint256 i = 1; i <= 16; i++) {
            uint256 random = uint256(keccak256(abi.encode(seed, i)));
            // Size varies independently of the call budget, including beyond the OO's size bound.
            bytes memory data = new bytes(random % 8209);
            uint256 mode = random % 3;
            vm.prank(owner);
            router.setForwardDelay(mode == 0 ? 0 : DELAY);
            _request(i, data);
            if (mode == 1) {
                _ready(); // Timestamp changes alone must not reset a block's budget.
                vm.prank(address(uint160(i + 100)));
                try router.forwardPriceRequest(IDENTIFIER, i, data) { } catch { }
            } else if (mode == 2) {
                vm.prank(council);
                try router.escalateNow(IDENTIFIER, i, data) { } catch { }
            }
            (uint32 limit, uint32 usedCount) = router.forwardBudget();
            (, uint64 forwarded,,) = router.priceRequests(keccak256(abi.encode(IDENTIFIER, i, data)));
            if (expectedCount < maxCount) {
                expectedCount++;
                assertGt(forwarded, 0);
            } else {
                assertEq(forwarded, 0);
            }
            assertEq(limit, maxCount);
            assertEq(usedCount, expectedCount);
            assertEq(oracle.requestCount(), usedCount);
        }
    }
}
