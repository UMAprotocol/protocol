pragma solidity ^0.5.0;


// This contract is only used to get a Manticore test up and running. It has no imports and an obvious bug.
// TODO(ptare): Delete this contract once we have a manticore test running for a real contract.
contract MetaCoin {
    uint256[] metadata;
    bool public constant shouldBeAlwaysFalse = false;

    function setMetadata(uint256 key, uint256 value) public {
        // Setting a large uint for key can end up overwriting the storage for the unrelated variable
        // `shouldAlwaysBeFalse`.
        if (metadata.length <= key) {
               metadata.length = key + 1;
        }
        metadata[key] = value;
    }
}
