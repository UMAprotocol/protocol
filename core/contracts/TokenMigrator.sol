pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "./ExpandedIERC20.sol";
import "./FixedPoint.sol";
import "openzeppelin-solidity/contracts/drafts/ERC20Snapshot.sol";


/**
 * @title Migration contract for VotingTokens.
 * @dev Handles migrating token holders from one token to the next.
 */
contract TokenMigrator {
    using FixedPoint for FixedPoint.Unsigned;

    ERC20Snapshot public oldToken;
    ExpandedIERC20 public newToken;
    uint public snapshotId;
    FixedPoint.Unsigned public rate;
    mapping(address => bool) public hasMigrated;

    /**
     * @notice Construct the TokenMigrator contract.
     * @dev This function triggers the snapshot upon which all migrations will be based.
     * @param _rate the number of old tokens it takes to generate one new token.
     * @param _oldToken the address of the token being migrated from.
     * @param _newToken the address of the token being migrated to.
     */
    constructor(FixedPoint.Unsigned memory _rate, address _oldToken, address _newToken) public {
        rate = _rate;
        newToken = ExpandedIERC20(_newToken);
        oldToken = ERC20Snapshot(_oldToken);
        snapshotId = oldToken.snapshot();
    }

    /**
     * @notice Migrates the tokenHolder's old tokens to new tokens.
     * @dev This function can only be called once per `tokenHolder`. Anyone can call this method on behalf of any other
     * token holder since there is no disadvantage to receiving the tokens earlier.
     */
    function migrateTokens(address tokenHolder) external {
        require(!hasMigrated[tokenHolder], "Already migrated tokens");
        hasMigrated[tokenHolder] = true;

        FixedPoint.Unsigned memory oldBalance = FixedPoint.Unsigned(oldToken.balanceOfAt(tokenHolder, snapshotId));

        if (!oldBalance.isGreaterThan(0)) {
            return;
        }

        FixedPoint.Unsigned memory newBalance = oldBalance.div(rate);
        require(newToken.mint(tokenHolder, newBalance.rawValue), "Mint failed");
    }
}
