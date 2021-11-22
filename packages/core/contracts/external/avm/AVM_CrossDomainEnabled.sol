// Copied logic from https://github.com/makerdao/arbitrum-dai-bridge/blob/34acc39bc6f3a2da0a837ea3c5dbc634ec61c7de/contracts/l2/L2CrossDomainEnabled.sol
// with a change to the solidity version.

pragma solidity ^0.8.0;

import "./interfaces/ArbSys.sol";

abstract contract AVM_CrossDomainEnabled {
    event SentCrossDomainMessage(address indexed from, address indexed to, uint256 indexed id, bytes data);

    modifier onlyFromCrossDomainAccount(address l1Counterpart) {
        require(msg.sender == applyL1ToL2Alias(l1Counterpart), "ONLY_COUNTERPART_GATEWAY");
        _;
    }

    uint160 constant offset = uint160(0x1111000000000000000000000000000000001111);

    // l1 addresses are transformed during l1->l2 calls. See https://developer.offchainlabs.com/docs/l1_l2_messages#address-aliasing for more information.
    function applyL1ToL2Alias(address l1Address) internal pure returns (address l2Address) {
        l2Address = address(uint160(l1Address) + offset);
    }

    // Sends a message to L1 via the ArbSys contract. See https://developer.offchainlabs.com/docs/arbsys.
    // After the Arbitrum chain advances some set amount of time, ArbOS gathers all outgoing messages, Merklizes them,
    // and publishes the root as an OutboxEntry in the chain's outbox. Note that this happens "automatically";
    // i.e., it requires no additional action from the user. After the Outbox entry is published on the L1 chain,
    // the user (or anybody) can compute the Merkle proof of inclusion of their outgoing message. Anytime after the
    // dispute window passes (~7 days), any user can execute the L1 message by calling Outbox.executeTransaction;
    // if it reverts, it can be re-executed any number of times and with no upper time-bound.
    // To read more about the L2 --> L1 lifecycle, see: https://developer.offchainlabs.com/docs/l1_l2_messages#explanation.
    function sendCrossDomainMessage(
        address user,
        address to,
        bytes memory data
    ) internal returns (uint256) {
        // note: this method doesn't support sending ether to L1 together with a call
        uint256 id = ArbSys(address(100)).sendTxToL1(to, data);

        emit SentCrossDomainMessage(user, to, id, data);

        return id;
    }
}
