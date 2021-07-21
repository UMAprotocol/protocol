// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity >=0.7.6;

contract OVM_L2CrossDomainMessengerMock {
    address xDomainMessageSender;

    function setXDomainMessageSender(address val) public {
        xDomainMessageSender = val;
    }
}
