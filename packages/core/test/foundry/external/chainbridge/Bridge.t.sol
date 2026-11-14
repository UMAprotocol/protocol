// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../../../../contracts/external/chainbridge/Bridge.sol";

contract BridgeTest is Test {
    function test_TracksUniqueInitialRelayers() public {
        address[] memory relayers = new address[](2);
        relayers[0] = address(0x1);
        relayers[1] = address(0x2);

        Bridge bridge = new Bridge(1, relayers, 2, 0, 100);

        assertEq(bridge._totalRelayers(), 2);
        assertTrue(bridge.isRelayer(relayers[0]));
        assertTrue(bridge.isRelayer(relayers[1]));
    }

    function test_RevertIf_DuplicateInitialRelayer() public {
        address[] memory relayers = new address[](2);
        relayers[0] = address(0x1);
        relayers[1] = address(0x1);

        vm.expectRevert("duplicate initial relayer");
        new Bridge(1, relayers, 2, 0, 100);
    }
}
