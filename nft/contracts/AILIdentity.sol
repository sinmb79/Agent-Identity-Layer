// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AILIdentity
 * @notice ERC-721 NFT representing an AI agent's official identity credential.
 *
 * Each token corresponds to one registered agent on the 22B Labs AIL system.
 *
 * Roles:
 *   owner  — contract owner (22B Labs deployer); can change minter
 *   minter — 22B Labs issuance server; only address allowed to mint and revoke
 *
 * Flow:
 *   1. POST /agents/register on the AIL server → server calls mint()
 *   2. Token URI = base64-encoded ERC-721 JSON with embedded SVG image
 *   3. DELETE /agents/:ail_id/revoke on the AIL server → server calls revoke()
 *      revoke() burns the NFT — ownership is destroyed
 *
 * Lookup:
 *   getTokenId(ailId)  → token ID (for marketplace/explorer links)
 *   getAilId(tokenId)  → AIL ID string
 *   isRegistered(ailId) → bool
 */
contract AILIdentity is ERC721, ERC721URIStorage, ERC721Burnable, Ownable {

    // ── State ──────────────────────────────────────────────────────────────

    uint256 private _nextTokenId;

    /// @notice Address authorized to mint and revoke tokens (22B Labs server wallet)
    address public minter;

    /// @dev AIL ID string → token ID
    mapping(string => uint256) private _ailIdToTokenId;

    /// @dev token ID → AIL ID string
    mapping(uint256 => string) private _tokenIdToAilId;

    /// @dev Track registered AIL IDs to prevent double-registration
    mapping(string => bool) private _registered;

    // ── Events ─────────────────────────────────────────────────────────────

    event AILMinted(
        uint256 indexed tokenId,
        string  indexed ailId,
        address indexed owner
    );

    event AILRevoked(
        uint256 indexed tokenId,
        string  ailId
    );

    event MinterChanged(
        address indexed previousMinter,
        address indexed newMinter
    );

    // ── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyMinter() {
        require(msg.sender == minter, "AILIdentity: caller is not the minter");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────

    /**
     * @param initialMinter  22B Labs server wallet address (can be updated later)
     */
    constructor(address initialMinter)
        ERC721("AIL Identity", "AIL")
        Ownable(msg.sender)
    {
        require(initialMinter != address(0), "AILIdentity: zero minter address");
        minter = initialMinter;
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    /**
     * @notice Update the authorized minter address.
     *         Call this after rotating the server wallet.
     */
    function setMinter(address newMinter) external onlyOwner {
        require(newMinter != address(0), "AILIdentity: zero minter address");
        emit MinterChanged(minter, newMinter);
        minter = newMinter;
    }

    // ── Minting ────────────────────────────────────────────────────────────

    /**
     * @notice Mint an AIL Identity NFT.
     *
     * @param to        Owner wallet address (the human/org who owns the agent)
     * @param ailId     AIL registration ID, e.g. "AIL-2026-00001"
     * @param uri       ERC-721 tokenURI — base64 SVG data URI or IPFS CID
     * @return tokenId  The newly minted token ID
     */
    function mint(
        address        to,
        string calldata ailId,
        string calldata uri
    ) external onlyMinter returns (uint256 tokenId) {
        require(to != address(0),         "AILIdentity: mint to zero address");
        require(bytes(ailId).length > 0,  "AILIdentity: empty AIL ID");
        require(!_registered[ailId],      "AILIdentity: AIL ID already registered");

        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        _ailIdToTokenId[ailId]  = tokenId;
        _tokenIdToAilId[tokenId] = ailId;
        _registered[ailId]       = true;

        emit AILMinted(tokenId, ailId, to);
    }

    // ── Revocation ─────────────────────────────────────────────────────────

    /**
     * @notice Revoke (burn) an AIL Identity NFT.
     *         Called when the owner revokes the agent credential on the AIL server.
     *         The NFT is permanently destroyed.
     *
     * @param tokenId  Token to burn
     */
    function revoke(uint256 tokenId) external onlyMinter {
        string memory ailId = _tokenIdToAilId[tokenId];
        require(bytes(ailId).length > 0, "AILIdentity: token does not exist");

        _burn(tokenId);

        delete _registered[ailId];
        delete _ailIdToTokenId[ailId];
        delete _tokenIdToAilId[tokenId];

        emit AILRevoked(tokenId, ailId);
    }

    // ── Views ──────────────────────────────────────────────────────────────

    /// @notice Look up the token ID for a given AIL ID.
    function getTokenId(string calldata ailId) external view returns (uint256) {
        require(_registered[ailId], "AILIdentity: AIL ID not registered");
        return _ailIdToTokenId[ailId];
    }

    /// @notice Look up the AIL ID for a given token ID.
    function getAilId(uint256 tokenId) external view returns (string memory) {
        require(bytes(_tokenIdToAilId[tokenId]).length > 0, "AILIdentity: token does not exist");
        return _tokenIdToAilId[tokenId];
    }

    /// @notice Check whether an AIL ID has an active (non-revoked) token.
    function isRegistered(string calldata ailId) external view returns (bool) {
        return _registered[ailId];
    }

    /// @notice Total number of tokens minted (including revoked ones in the counter).
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    // ── Overrides required by Solidity ─────────────────────────────────────

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
