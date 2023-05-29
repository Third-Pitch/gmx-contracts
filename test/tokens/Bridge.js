const { expect, use } = require("chai")
require("@nomicfoundation/hardhat-chai-matchers");
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")



describe("Bridge", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let eddx
  let weddx
  let bridge

  beforeEach(async () => {
    eddx = await deployContract("EDDX", [])
    weddx = await deployContract("EDDX", [])
    bridge = await deployContract("Bridge", [eddx.address, weddx.address])
  })

  it("wrap, unwrap", async () => {
    await eddx.setMinter(wallet.address, true)
    await eddx.mint(user0.address, 100)
    await eddx.connect(user0).approve(bridge.address, 100)
    await expect(bridge.connect(user0).wrap(200, user1.address))
      .to.be.revertedWith("BaseToken: transfer amount exceeds allowance")

    await expect(bridge.connect(user0).wrap(100, user1.address))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await weddx.setMinter(wallet.address, true)
    await weddx.mint(bridge.address, 50)

    await expect(bridge.connect(user0).wrap(100, user1.address))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await weddx.mint(bridge.address, 50)

    expect(await eddx.balanceOf(user0.address)).eq(100)
    expect(await eddx.balanceOf(bridge.address)).eq(0)
    expect(await weddx.balanceOf(user1.address)).eq(0)
    expect(await weddx.balanceOf(bridge.address)).eq(100)

    await bridge.connect(user0).wrap(100, user1.address)

    expect(await eddx.balanceOf(user0.address)).eq(0)
    expect(await eddx.balanceOf(bridge.address)).eq(100)
    expect(await weddx.balanceOf(user1.address)).eq(100)
    expect(await weddx.balanceOf(bridge.address)).eq(0)

    await weddx.connect(user1).approve(bridge.address, 100)

    expect(await eddx.balanceOf(user2.address)).eq(0)
    expect(await eddx.balanceOf(bridge.address)).eq(100)
    expect(await weddx.balanceOf(user1.address)).eq(100)
    expect(await weddx.balanceOf(bridge.address)).eq(0)

    await bridge.connect(user1).unwrap(100, user2.address)

    expect(await eddx.balanceOf(user2.address)).eq(100)
    expect(await eddx.balanceOf(bridge.address)).eq(0)
    expect(await weddx.balanceOf(user1.address)).eq(0)
    expect(await weddx.balanceOf(bridge.address)).eq(100)
  })

  it("withdrawToken", async () => {
    await eddx.setMinter(wallet.address, true)
    await eddx.mint(bridge.address, 100)

    await expect(bridge.connect(user0).withdrawToken(eddx.address, user1.address, 100))
      .to.be.revertedWith("Governable: forbidden")

    await expect(bridge.connect(user0).setGov(user0.address))
      .to.be.revertedWith("Governable: forbidden")

    await bridge.connect(wallet).setGov(user0.address)

    expect(await eddx.balanceOf(user1.address)).eq(0)
    expect(await eddx.balanceOf(bridge.address)).eq(100)
    await bridge.connect(user0).withdrawToken(eddx.address, user1.address, 100)
    expect(await eddx.balanceOf(user1.address)).eq(100)
    expect(await eddx.balanceOf(bridge.address)).eq(0)
  })
})
