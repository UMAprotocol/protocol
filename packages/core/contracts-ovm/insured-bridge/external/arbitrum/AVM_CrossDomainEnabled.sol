pragma solidity ^0.7.6;

abstract contract AVM_CrossDomainEnabled {
    modifier onlyFromCrossDomainAccount(address l1Counterpart) {
        require(msg.sender == applyL1ToL2Alias(l1Counterpart), "ONLY_COUNTERPART_GATEWAY");
        _;
    }

    uint160 constant offset = uint160(0x1111000000000000000000000000000000001111);

    // l1 addresses are transformed durng l1->l2 calls
    function applyL1ToL2Alias(address l1Address) internal pure returns (address l2Address) {
        l2Address = address(uint160(l1Address) + offset);
    }
}
