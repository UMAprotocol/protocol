// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract OptimisticRewarderToken is ERC721 {
    string public baseUri;
    uint256 public nextTokenId;

    /**
     * @notice Constructor.
     * @param _name name for the ERC721 token.
     * @param _symbol symbol for the ERC721 token.
     * @param _baseUri prefix to each ERC721 tokenId's name.
     */
    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseUri
    ) ERC721(_name, _symbol) {
        nextTokenId = 0;
        baseUri = _baseUri;
    }

    /**
     * @notice Used to mint the next ERC721 tokenId.
     * @param recipient the recipient of the newly minted token.
     */
    function mintNextToken(address recipient) public virtual returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(recipient, tokenId);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseUri;
    }
}
