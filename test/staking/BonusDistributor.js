const { expect, use } = require("chai")
require("@nomicfoundation/hardhat-chai-matchers");
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")



describe("BonusDistributor", function () {
  const provider = waffle.provider
  const [wallet, rewardRouter, user0, user1, user2, user3] = provider.getWallets()
  let eddx
  let esEddx
  let bnEddx
  let stakedEddxTracker
  let stakedEddxDistributor
  let bonusEddxTracker
  let bonusEddxDistributor

  beforeEach(async () => {
    eddx = await deployContract("EDDX", []);
    esEddx = await deployContract("EsEDDX", []);
    bnEddx = await deployContract("MintableBaseToken", ["Bonus EDDX", "bnEDDX", 0]);

    stakedEddxTracker = await deployContract("StakedEddxTracker", ["Staked EDDX", "stEDDX"])
    stakedEddxDistributor = await deployContract("RewardDistributor", [esEddx.address, stakedEddxTracker.address])
    await stakedEddxDistributor.updateLastDistributionTime()

    bonusEddxTracker = await deployContract("RewardTracker", ["Staked + Bonus EDDX", "sbEDDX"])
    bonusEddxDistributor = await deployContract("BonusDistributor", [bnEddx.address, bonusEddxTracker.address])
    await bonusEddxDistributor.updateLastDistributionTime()

    await stakedEddxTracker.initialize([eddx.address, esEddx.address], stakedEddxDistributor.address)
    await bonusEddxTracker.initialize([stakedEddxTracker.address], bonusEddxDistributor.address)

    await stakedEddxTracker.setInPrivateTransferMode(true)
    await stakedEddxTracker.setInPrivateStakingMode(true)
    await bonusEddxTracker.setInPrivateTransferMode(true)
    await bonusEddxTracker.setInPrivateStakingMode(true)

    await stakedEddxTracker.setHandler(rewardRouter.address, true)
    await stakedEddxTracker.setHandler(bonusEddxTracker.address, true)
    await bonusEddxTracker.setHandler(rewardRouter.address, true)
    await bonusEddxDistributor.setBonusMultiplier(10000)
  })

  it("distributes bonus", async () => {
    await esEddx.setMinter(wallet.address, true)
    await esEddx.mint(stakedEddxDistributor.address, expandDecimals(50000, 18))
    await bnEddx.setMinter(wallet.address, true)
    await bnEddx.mint(bonusEddxDistributor.address, expandDecimals(1500, 18))
    await stakedEddxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esEddx per second
    await eddx.setMinter(wallet.address, true)
    await eddx.mint(user0.address, expandDecimals(1000, 18))

    await eddx.connect(user0).approve(stakedEddxTracker.address, expandDecimals(1001, 18))
    await expect(stakedEddxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, eddx.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")
    await stakedEddxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, eddx.address, expandDecimals(1000, 18))
    await expect(bonusEddxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, stakedEddxTracker.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")
    await bonusEddxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, stakedEddxTracker.address, expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedEddxTracker.claimable(user0.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedEddxTracker.claimable(user0.address)).lt(expandDecimals(1786, 18))
    expect(await bonusEddxTracker.claimable(user0.address)).gt("2730000000000000000") // 2.73, 1000 / 365 => ~2.74
    expect(await bonusEddxTracker.claimable(user0.address)).lt("2750000000000000000") // 2.75

    await esEddx.mint(user1.address, expandDecimals(500, 18))
    await esEddx.connect(user1).approve(stakedEddxTracker.address, expandDecimals(500, 18))
    await stakedEddxTracker.connect(rewardRouter).stakeForAccount(user1.address, user1.address, esEddx.address, expandDecimals(500, 18))
    await bonusEddxTracker.connect(rewardRouter).stakeForAccount(user1.address, user1.address, stakedEddxTracker.address, expandDecimals(500, 18))


    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedEddxTracker.claimable(user0.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedEddxTracker.claimable(user0.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await stakedEddxTracker.claimable(user1.address)).gt(expandDecimals(595, 18))
    expect(await stakedEddxTracker.claimable(user1.address)).lt(expandDecimals(596, 18))

    expect(await bonusEddxTracker.claimable(user0.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusEddxTracker.claimable(user0.address)).lt("5490000000000000000") // 5.49

    expect(await bonusEddxTracker.claimable(user1.address)).gt("1360000000000000000") // 1.36, 500 / 365 => ~1.37
    expect(await bonusEddxTracker.claimable(user1.address)).lt("1380000000000000000") // 1.38
  })
})
