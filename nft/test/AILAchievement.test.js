const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AILAchievement", function () {
  let contract;
  let owner, minter, holder, other;

  const SAMPLE_URI = "https://agentidcard.org/badges/pioneer.json";

  beforeEach(async function () {
    [owner, minter, holder, other] = await ethers.getSigners();
    const AILAchievement = await ethers.getContractFactory("AILAchievement");
    contract = await AILAchievement.deploy(minter.address);
  });

  it("mints a soulbound badge and stores badge metadata", async function () {
    await expect(
      contract.connect(minter).mintBadge(
        holder.address,
        "AIL-2026-00042",
        42,
        "pioneer",
        "agentcraft",
        SAMPLE_URI
      )
    ).to.emit(contract, "Transfer").withArgs(ethers.ZeroAddress, holder.address, 1);

    expect(await contract.ownerOf(1)).to.equal(holder.address);

    const badge = await contract.badges(1);
    expect(badge.ailId).to.equal("AIL-2026-00042");
    expect(badge.ailTokenId).to.equal(42);
    expect(badge.badgeId).to.equal("pioneer");
    expect(badge.source).to.equal("agentcraft");
    expect(badge.metadataURI).to.equal(SAMPLE_URI);
  });

  it("blocks badge transfers because the token is soulbound", async function () {
    await contract.connect(minter).mintBadge(
      holder.address,
      "AIL-2026-00042",
      42,
      "pioneer",
      "agentcraft",
      SAMPLE_URI
    );

    await expect(
      contract.connect(holder).transferFrom(holder.address, other.address, 1)
    ).to.be.revertedWith("Soulbound: transfer not allowed");
  });

  it("does not mint the same badge twice for the same AIL ID", async function () {
    await contract.connect(minter).mintBadge(
      holder.address,
      "AIL-2026-00042",
      42,
      "pioneer",
      "agentcraft",
      SAMPLE_URI
    );

    await expect(
      contract.connect(minter).mintBadge(
        holder.address,
        "AIL-2026-00042",
        42,
        "pioneer",
        "agentcraft",
        SAMPLE_URI
      )
    ).to.be.revertedWith("Badge already minted");
  });

  it("allows the minter to burn a badge", async function () {
    await contract.connect(minter).mintBadge(
      holder.address,
      "AIL-2026-00042",
      42,
      "pioneer",
      "agentcraft",
      SAMPLE_URI
    );

    await contract.connect(minter).burn(1);
    await expect(contract.ownerOf(1)).to.be.reverted;
  });
});
