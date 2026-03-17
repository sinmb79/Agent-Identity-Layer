const { expect }  = require("chai");
const { ethers }  = require("hardhat");

describe("AILIdentity", function () {
  let contract;
  let owner, minter, user1, user2;

  const SAMPLE_AIL_ID  = "AIL-2026-00001";
  const SAMPLE_URI     = "data:application/json;base64,eyJuYW1lIjoiVGVzdCJ9";

  beforeEach(async function () {
    [owner, minter, user1, user2] = await ethers.getSigners();
    const AILIdentity = await ethers.getContractFactory("AILIdentity");
    contract = await AILIdentity.deploy(minter.address);
  });

  describe("Deployment", function () {
    it("sets the correct minter", async function () {
      expect(await contract.minter()).to.equal(minter.address);
    });

    it("sets the deployer as owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });
  });

  describe("Minting", function () {
    it("minter can mint a token", async function () {
      await expect(
        contract.connect(minter).mint(user1.address, SAMPLE_AIL_ID, SAMPLE_URI)
      ).to.emit(contract, "AILMinted").withArgs(1, SAMPLE_AIL_ID, user1.address);

      expect(await contract.ownerOf(1)).to.equal(user1.address);
      expect(await contract.tokenURI(1)).to.equal(SAMPLE_URI);
      expect(await contract.getTokenId(SAMPLE_AIL_ID)).to.equal(1);
      expect(await contract.getAilId(1)).to.equal(SAMPLE_AIL_ID);
      expect(await contract.isRegistered(SAMPLE_AIL_ID)).to.be.true;
    });

    it("non-minter cannot mint", async function () {
      await expect(
        contract.connect(user1).mint(user1.address, SAMPLE_AIL_ID, SAMPLE_URI)
      ).to.be.revertedWith("AILIdentity: caller is not the minter");
    });

    it("cannot register the same AIL ID twice", async function () {
      await contract.connect(minter).mint(user1.address, SAMPLE_AIL_ID, SAMPLE_URI);
      await expect(
        contract.connect(minter).mint(user2.address, SAMPLE_AIL_ID, SAMPLE_URI)
      ).to.be.revertedWith("AILIdentity: AIL ID already registered");
    });

    it("increments totalMinted", async function () {
      await contract.connect(minter).mint(user1.address, SAMPLE_AIL_ID, SAMPLE_URI);
      await contract.connect(minter).mint(user1.address, "AIL-2026-00002", SAMPLE_URI);
      expect(await contract.totalMinted()).to.equal(2);
    });
  });

  describe("Revocation", function () {
    beforeEach(async function () {
      await contract.connect(minter).mint(user1.address, SAMPLE_AIL_ID, SAMPLE_URI);
    });

    it("minter can revoke (burn) a token", async function () {
      await expect(
        contract.connect(minter).revoke(1)
      ).to.emit(contract, "AILRevoked").withArgs(1, SAMPLE_AIL_ID);

      expect(await contract.isRegistered(SAMPLE_AIL_ID)).to.be.false;
    });

    it("AIL ID is freed after revocation — can be re-registered", async function () {
      await contract.connect(minter).revoke(1);
      await expect(
        contract.connect(minter).mint(user2.address, SAMPLE_AIL_ID, SAMPLE_URI)
      ).to.emit(contract, "AILMinted");
    });

    it("non-minter cannot revoke", async function () {
      await expect(
        contract.connect(user1).revoke(1)
      ).to.be.revertedWith("AILIdentity: caller is not the minter");
    });
  });

  describe("Admin", function () {
    it("owner can change minter", async function () {
      await expect(
        contract.connect(owner).setMinter(user2.address)
      ).to.emit(contract, "MinterChanged").withArgs(minter.address, user2.address);

      expect(await contract.minter()).to.equal(user2.address);
    });

    it("non-owner cannot change minter", async function () {
      await expect(
        contract.connect(user1).setMinter(user2.address)
      ).to.be.reverted;
    });
  });
});
