const { expect, use } = require("chai")
require("@nomicfoundation/hardhat-chai-matchers");
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("../core/Vault/helpers")
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"



describe("RewardRouter", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()

  let vault
  let elpManager
  let elp
  let usdg
  let router
  let vaultPriceFeed
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let eth
  let ethPriceFeed
  let dai
  let daiPriceFeed
  let busd
  let busdPriceFeed

  let eddx
  let esEddx
  let bnEddx

  let stakedEddxTracker
  let stakedEddxDistributor
  let bonusEddxTracker
  let bonusEddxDistributor
  let feeEddxTracker
  let feeEddxDistributor

  let feeElpTracker
  let feeElpDistributor
  let stakedElpTracker
  let stakedElpDistributor

  let rewardRouter

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    busd = await deployContract("Token", [])
    busdPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployContract("Vault", [])
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, bnb.address])
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])
    elp = await deployContract("ELP", [])

    await initVault(vault, router, usdg, vaultPriceFeed)
    elpManager = await deployContract("ElpManager", [vault.address, usdg.address, elp.address, ethers.constants.AddressZero, 24 * 60 * 60])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await elp.setInPrivateTransferMode(true)
    await elp.setMinter(elpManager.address, true)
    await elpManager.setInPrivateMode(true)

    eddx = await deployContract("EDDX", []);
    esEddx = await deployContract("EsEDDX", []);
    bnEddx = await deployContract("MintableBaseToken", ["Bonus EDDX", "bnEDDX", 0]);

    // EDDX
    stakedEddxTracker = await deployContract("RewardTracker", ["Staked EDDX", "sEDDX"])
    stakedEddxDistributor = await deployContract("RewardDistributor", [esEddx.address, stakedEddxTracker.address])
    await stakedEddxTracker.initialize([eddx.address, esEddx.address], stakedEddxDistributor.address)
    await stakedEddxDistributor.updateLastDistributionTime()

    bonusEddxTracker = await deployContract("RewardTracker", ["Staked + Bonus EDDX", "sbEDDX"])
    bonusEddxDistributor = await deployContract("BonusDistributor", [bnEddx.address, bonusEddxTracker.address])
    await bonusEddxTracker.initialize([stakedEddxTracker.address], bonusEddxDistributor.address)
    await bonusEddxDistributor.updateLastDistributionTime()

    feeEddxTracker = await deployContract("RewardTracker", ["Staked + Bonus + Fee EDDX", "sbfEDDX"])
    feeEddxDistributor = await deployContract("RewardDistributor", [eth.address, feeEddxTracker.address])
    await feeEddxTracker.initialize([bonusEddxTracker.address, bnEddx.address], feeEddxDistributor.address)
    await feeEddxDistributor.updateLastDistributionTime()

    // ELP
    feeElpTracker = await deployContract("RewardTracker", ["Fee ELP", "fELP"])
    feeElpDistributor = await deployContract("RewardDistributor", [eth.address, feeElpTracker.address])
    await feeElpTracker.initialize([elp.address], feeElpDistributor.address)
    await feeElpDistributor.updateLastDistributionTime()

    stakedElpTracker = await deployContract("RewardTracker", ["Fee + Staked ELP", "fsELP"])
    stakedElpDistributor = await deployContract("RewardDistributor", [esEddx.address, stakedElpTracker.address])
    await stakedElpTracker.initialize([feeElpTracker.address], stakedElpDistributor.address)
    await stakedElpDistributor.updateLastDistributionTime()

    await stakedEddxTracker.setInPrivateTransferMode(true)
    await stakedEddxTracker.setInPrivateStakingMode(true)
    await bonusEddxTracker.setInPrivateTransferMode(true)
    await bonusEddxTracker.setInPrivateStakingMode(true)
    await bonusEddxTracker.setInPrivateClaimingMode(true)
    await feeEddxTracker.setInPrivateTransferMode(true)
    await feeEddxTracker.setInPrivateStakingMode(true)

    await feeElpTracker.setInPrivateTransferMode(true)
    await feeElpTracker.setInPrivateStakingMode(true)
    await stakedElpTracker.setInPrivateTransferMode(true)
    await stakedElpTracker.setInPrivateStakingMode(true)

    rewardRouter = await deployContract("RewardRouter", [])
    await rewardRouter.initialize(
      bnb.address,
      eddx.address,
      esEddx.address,
      bnEddx.address,
      elp.address,
      stakedEddxTracker.address,
      bonusEddxTracker.address,
      feeEddxTracker.address,
      feeElpTracker.address,
      stakedElpTracker.address,
      elpManager.address
    )

    // allow rewardRouter to stake in stakedEddxTracker
    await stakedEddxTracker.setHandler(rewardRouter.address, true)
    // allow bonusEddxTracker to stake stakedEddxTracker
    await stakedEddxTracker.setHandler(bonusEddxTracker.address, true)
    // allow rewardRouter to stake in bonusEddxTracker
    await bonusEddxTracker.setHandler(rewardRouter.address, true)
    // allow bonusEddxTracker to stake feeEddxTracker
    await bonusEddxTracker.setHandler(feeEddxTracker.address, true)
    await bonusEddxDistributor.setBonusMultiplier(10000)
    // allow rewardRouter to stake in feeEddxTracker
    await feeEddxTracker.setHandler(rewardRouter.address, true)
    // allow feeEddxTracker to stake bnEddx
    await bnEddx.setHandler(feeEddxTracker.address, true)
    // allow rewardRouter to burn bnEddx
    await bnEddx.setMinter(rewardRouter.address, true)

    // allow rewardRouter to mint in elpManager
    await elpManager.setHandler(rewardRouter.address, true)
    // allow rewardRouter to stake in feeElpTracker
    await feeElpTracker.setHandler(rewardRouter.address, true)
    // allow stakedElpTracker to stake feeElpTracker
    await feeElpTracker.setHandler(stakedElpTracker.address, true)
    // allow rewardRouter to sake in stakedElpTracker
    await stakedElpTracker.setHandler(rewardRouter.address, true)
    // allow feeElpTracker to stake elp
    await elp.setHandler(feeElpTracker.address, true)

    // mint esEddx for distributors
    await esEddx.setMinter(wallet.address, true)
    await esEddx.mint(stakedEddxDistributor.address, expandDecimals(50000, 18))
    await stakedEddxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esEddx per second
    await esEddx.mint(stakedElpDistributor.address, expandDecimals(50000, 18))
    await stakedElpDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esEddx per second

    await esEddx.setInPrivateTransferMode(true)
    await esEddx.setHandler(stakedEddxDistributor.address, true)
    await esEddx.setHandler(stakedElpDistributor.address, true)
    await esEddx.setHandler(stakedEddxTracker.address, true)
    await esEddx.setHandler(stakedElpTracker.address, true)
    await esEddx.setHandler(rewardRouter.address, true)

    // mint bnEddx for distributor
    await bnEddx.setMinter(wallet.address, true)
    await bnEddx.mint(bonusEddxDistributor.address, expandDecimals(1500, 18))
  })

  it("inits", async () => {
    expect(await rewardRouter.isInitialized()).eq(true)

    expect(await rewardRouter.weth()).eq(bnb.address)
    expect(await rewardRouter.eddx()).eq(eddx.address)
    expect(await rewardRouter.esEddx()).eq(esEddx.address)
    expect(await rewardRouter.bnEddx()).eq(bnEddx.address)

    expect(await rewardRouter.elp()).eq(elp.address)

    expect(await rewardRouter.stakedEddxTracker()).eq(stakedEddxTracker.address)
    expect(await rewardRouter.bonusEddxTracker()).eq(bonusEddxTracker.address)
    expect(await rewardRouter.feeEddxTracker()).eq(feeEddxTracker.address)

    expect(await rewardRouter.feeElpTracker()).eq(feeElpTracker.address)
    expect(await rewardRouter.stakedElpTracker()).eq(stakedElpTracker.address)

    expect(await rewardRouter.elpManager()).eq(elpManager.address)

    await expect(rewardRouter.initialize(
      bnb.address,
      eddx.address,
      esEddx.address,
      bnEddx.address,
      elp.address,
      stakedEddxTracker.address,
      bonusEddxTracker.address,
      feeEddxTracker.address,
      feeElpTracker.address,
      stakedElpTracker.address,
      elpManager.address
    )).to.be.revertedWith("RewardRouter: already initialized")
  })

  it("stakeEddxForAccount, stakeEddx, stakeEsEddx, unstakeEddx, unstakeEsEddx, claimEsEddx, claimFees, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeEddxDistributor.address, expandDecimals(100, 18))
    await feeEddxDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await eddx.setMinter(wallet.address, true)
    await eddx.mint(user0.address, expandDecimals(1500, 18))
    expect(await eddx.balanceOf(user0.address)).eq(expandDecimals(1500, 18))

    await eddx.connect(user0).approve(stakedEddxTracker.address, expandDecimals(1000, 18))
    await expect(rewardRouter.connect(user0).stakeEddxForAccount(user1.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Governable: forbidden")

    await rewardRouter.setGov(user0.address)
    await rewardRouter.connect(user0).stakeEddxForAccount(user1.address, expandDecimals(800, 18))
    expect(await eddx.balanceOf(user0.address)).eq(expandDecimals(700, 18))

    await eddx.mint(user1.address, expandDecimals(200, 18))
    expect(await eddx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await eddx.connect(user1).approve(stakedEddxTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeEddx(expandDecimals(200, 18))
    expect(await eddx.balanceOf(user1.address)).eq(0)

    expect(await stakedEddxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user0.address, eddx.address)).eq(0)
    expect(await stakedEddxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(1000, 18))

    expect(await bonusEddxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await bonusEddxTracker.depositBalances(user0.address, stakedEddxTracker.address)).eq(0)
    expect(await bonusEddxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await bonusEddxTracker.depositBalances(user1.address, stakedEddxTracker.address)).eq(expandDecimals(1000, 18))

    expect(await feeEddxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await feeEddxTracker.depositBalances(user0.address, bonusEddxTracker.address)).eq(0)
    expect(await feeEddxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bonusEddxTracker.address)).eq(expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedEddxTracker.claimable(user0.address)).eq(0)
    expect(await stakedEddxTracker.claimable(user1.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedEddxTracker.claimable(user1.address)).lt(expandDecimals(1786, 18))

    expect(await bonusEddxTracker.claimable(user0.address)).eq(0)
    expect(await bonusEddxTracker.claimable(user1.address)).gt("2730000000000000000") // 2.73, 1000 / 365 => ~2.74
    expect(await bonusEddxTracker.claimable(user1.address)).lt("2750000000000000000") // 2.75

    expect(await feeEddxTracker.claimable(user0.address)).eq(0)
    expect(await feeEddxTracker.claimable(user1.address)).gt("3560000000000000000") // 3.56, 100 / 28 => ~3.57
    expect(await feeEddxTracker.claimable(user1.address)).lt("3580000000000000000") // 3.58

    await esEddx.setMinter(wallet.address, true)
    await esEddx.mint(user2.address, expandDecimals(500, 18))
    await rewardRouter.connect(user2).stakeEsEddx(expandDecimals(500, 18))

    expect(await stakedEddxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user0.address, eddx.address)).eq(0)
    expect(await stakedEddxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(1000, 18))
    expect(await stakedEddxTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await stakedEddxTracker.depositBalances(user2.address, esEddx.address)).eq(expandDecimals(500, 18))

    expect(await bonusEddxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await bonusEddxTracker.depositBalances(user0.address, stakedEddxTracker.address)).eq(0)
    expect(await bonusEddxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await bonusEddxTracker.depositBalances(user1.address, stakedEddxTracker.address)).eq(expandDecimals(1000, 18))
    expect(await bonusEddxTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await bonusEddxTracker.depositBalances(user2.address, stakedEddxTracker.address)).eq(expandDecimals(500, 18))

    expect(await feeEddxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await feeEddxTracker.depositBalances(user0.address, bonusEddxTracker.address)).eq(0)
    expect(await feeEddxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bonusEddxTracker.address)).eq(expandDecimals(1000, 18))
    expect(await feeEddxTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await feeEddxTracker.depositBalances(user2.address, bonusEddxTracker.address)).eq(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedEddxTracker.claimable(user0.address)).eq(0)
    expect(await stakedEddxTracker.claimable(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedEddxTracker.claimable(user1.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await stakedEddxTracker.claimable(user2.address)).gt(expandDecimals(595, 18))
    expect(await stakedEddxTracker.claimable(user2.address)).lt(expandDecimals(596, 18))

    expect(await bonusEddxTracker.claimable(user0.address)).eq(0)
    expect(await bonusEddxTracker.claimable(user1.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusEddxTracker.claimable(user1.address)).lt("5490000000000000000")
    expect(await bonusEddxTracker.claimable(user2.address)).gt("1360000000000000000") // 1.36, 500 / 365 => ~1.37
    expect(await bonusEddxTracker.claimable(user2.address)).lt("1380000000000000000")

    expect(await feeEddxTracker.claimable(user0.address)).eq(0)
    expect(await feeEddxTracker.claimable(user1.address)).gt("5940000000000000000") // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeEddxTracker.claimable(user1.address)).lt("5960000000000000000")
    expect(await feeEddxTracker.claimable(user2.address)).gt("1180000000000000000") // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeEddxTracker.claimable(user2.address)).lt("1200000000000000000")

    expect(await esEddx.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimEsEddx()
    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await eth.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimFees()
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000")
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000")

    expect(await esEddx.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimEsEddx()
    expect(await esEddx.balanceOf(user2.address)).gt(expandDecimals(595, 18))
    expect(await esEddx.balanceOf(user2.address)).lt(expandDecimals(596, 18))

    expect(await eth.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimFees()
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000")
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx0 = await rewardRouter.connect(user1).compound()
    await reportGasUsed(provider, tx0, "compound gas used")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx1 = await rewardRouter.connect(user0).batchCompoundForAccounts([user1.address, user2.address])
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used")

    expect(await stakedEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3643, 18))
    expect(await stakedEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3645, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(1000, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).gt(expandDecimals(2643, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).lt(expandDecimals(2645, 18))

    expect(await bonusEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3643, 18))
    expect(await bonusEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3645, 18))

    expect(await feeEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3657, 18))
    expect(await feeEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3659, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bonusEddxTracker.address)).gt(expandDecimals(3643, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bonusEddxTracker.address)).lt(expandDecimals(3645, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt("14100000000000000000") // 14.1
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt("14300000000000000000") // 14.3

    expect(await eddx.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).unstakeEddx(expandDecimals(300, 18))
    expect(await eddx.balanceOf(user1.address)).eq(expandDecimals(300, 18))

    expect(await stakedEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3343, 18))
    expect(await stakedEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3345, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(700, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).gt(expandDecimals(2643, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).lt(expandDecimals(2645, 18))

    expect(await bonusEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3343, 18))
    expect(await bonusEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3345, 18))

    expect(await feeEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3357, 18))
    expect(await feeEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3359, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bonusEddxTracker.address)).gt(expandDecimals(3343, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bonusEddxTracker.address)).lt(expandDecimals(3345, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt("13000000000000000000") // 13
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt("13100000000000000000") // 13.1

    const esEddxBalance1 = await esEddx.balanceOf(user1.address)
    const esEddxUnstakeBalance1 = await stakedEddxTracker.depositBalances(user1.address, esEddx.address)
    await rewardRouter.connect(user1).unstakeEsEddx(esEddxUnstakeBalance1)
    expect(await esEddx.balanceOf(user1.address)).eq(esEddxBalance1.add(esEddxUnstakeBalance1))

    expect(await stakedEddxTracker.stakedAmounts(user1.address)).eq(expandDecimals(700, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(700, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).eq(0)

    expect(await bonusEddxTracker.stakedAmounts(user1.address)).eq(expandDecimals(700, 18))

    expect(await feeEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(702, 18))
    expect(await feeEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(703, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bonusEddxTracker.address)).eq(expandDecimals(700, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt("2720000000000000000") // 2.72
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt("2740000000000000000") // 2.74

    await expect(rewardRouter.connect(user1).unstakeEsEddx(expandDecimals(1, 18)))
      .to.be.revertedWith("RewardTracker: _amount exceeds depositBalance")
  })

  it("mintAndStakeElp, unstakeAndRedeemElp, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeElpDistributor.address, expandDecimals(100, 18))
    await feeElpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(elpManager.address, expandDecimals(1, 18))
    const tx0 = await rewardRouter.connect(user1).mintAndStakeElp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )
    await reportGasUsed(provider, tx0, "mintAndStakeElp gas used")

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeElpTracker.depositBalances(user1.address, elp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedElpTracker.depositBalances(user1.address, feeElpTracker.address)).eq(expandDecimals(2991, 17))

    await bnb.mint(user1.address, expandDecimals(2, 18))
    await bnb.connect(user1).approve(elpManager.address, expandDecimals(2, 18))
    await rewardRouter.connect(user1).mintAndStakeElp(
      bnb.address,
      expandDecimals(2, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await increaseTime(provider, 24 * 60 * 60 + 1)
    await mineBlock(provider)

    expect(await feeElpTracker.claimable(user1.address)).gt("3560000000000000000") // 3.56, 100 / 28 => ~3.57
    expect(await feeElpTracker.claimable(user1.address)).lt("3580000000000000000") // 3.58

    expect(await stakedElpTracker.claimable(user1.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedElpTracker.claimable(user1.address)).lt(expandDecimals(1786, 18))

    await bnb.mint(user2.address, expandDecimals(1, 18))
    await bnb.connect(user2).approve(elpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user2).mintAndStakeElp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await expect(rewardRouter.connect(user2).unstakeAndRedeemElp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user2.address
    )).to.be.revertedWith("ElpManager: cooldown duration not yet passed")

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq("897300000000000000000") // 897.3
    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq("897300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq(0)

    const tx1 = await rewardRouter.connect(user1).unstakeAndRedeemElp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user1.address
    )
    await reportGasUsed(provider, tx1, "unstakeAndRedeemElp gas used")

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq("598300000000000000000") // 598.3
    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666") // ~0.99

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await feeElpTracker.claimable(user1.address)).gt("5940000000000000000") // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeElpTracker.claimable(user1.address)).lt("5960000000000000000")
    expect(await feeElpTracker.claimable(user2.address)).gt("1180000000000000000") // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeElpTracker.claimable(user2.address)).lt("1200000000000000000")

    expect(await stakedElpTracker.claimable(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedElpTracker.claimable(user1.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await stakedElpTracker.claimable(user2.address)).gt(expandDecimals(595, 18))
    expect(await stakedElpTracker.claimable(user2.address)).lt(expandDecimals(596, 18))

    expect(await esEddx.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimEsEddx()
    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await eth.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimFees()
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000")
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000")

    expect(await esEddx.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimEsEddx()
    expect(await esEddx.balanceOf(user2.address)).gt(expandDecimals(595, 18))
    expect(await esEddx.balanceOf(user2.address)).lt(expandDecimals(596, 18))

    expect(await eth.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimFees()
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000")
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx2 = await rewardRouter.connect(user1).compound()
    await reportGasUsed(provider, tx2, "compound gas used")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx3 = await rewardRouter.batchCompoundForAccounts([user1.address, user2.address])
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used")

    expect(await stakedEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(4165, 18))
    expect(await stakedEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(4167, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).gt(expandDecimals(4165, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).lt(expandDecimals(4167, 18))

    expect(await bonusEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(4165, 18))
    expect(await bonusEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(4167, 18))

    expect(await feeEddxTracker.stakedAmounts(user1.address)).gt(expandDecimals(4179, 18))
    expect(await feeEddxTracker.stakedAmounts(user1.address)).lt(expandDecimals(4180, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bonusEddxTracker.address)).gt(expandDecimals(4165, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bonusEddxTracker.address)).lt(expandDecimals(4167, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt("12900000000000000000") // 12.9
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt("13100000000000000000") // 13.1

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq("598300000000000000000") // 598.3
    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666") // ~0.99
  })

  it("mintAndStakeElpETH, unstakeAndRedeemElpETH", async () => {
    const receiver0 = newWallet()
    await expect(rewardRouter.connect(user0).mintAndStakeElpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: 0 }))
      .to.be.revertedWith("RewardRouter: invalid msg.value")

    await expect(rewardRouter.connect(user0).mintAndStakeElpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) }))
      .to.be.revertedWith("ElpManager: insufficient USDG output")

    await expect(rewardRouter.connect(user0).mintAndStakeElpETH(expandDecimals(299, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) }))
      .to.be.revertedWith("ElpManager: insufficient ELP output")

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(vault.address)).eq(0)
    expect(await bnb.totalSupply()).eq(0)
    expect(await provider.getBalance(bnb.address)).eq(0)
    expect(await stakedElpTracker.balanceOf(user0.address)).eq(0)

    await rewardRouter.connect(user0).mintAndStakeElpETH(expandDecimals(299, 18), expandDecimals(299, 18), { value: expandDecimals(1, 18) })

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(vault.address)).eq(expandDecimals(1, 18))
    expect(await provider.getBalance(bnb.address)).eq(expandDecimals(1, 18))
    expect(await bnb.totalSupply()).eq(expandDecimals(1, 18))
    expect(await stakedElpTracker.balanceOf(user0.address)).eq("299100000000000000000") // 299.1

    await expect(rewardRouter.connect(user0).unstakeAndRedeemElpETH(expandDecimals(300, 18), expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    await expect(rewardRouter.connect(user0).unstakeAndRedeemElpETH("299100000000000000000", expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("ElpManager: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)

    await expect(rewardRouter.connect(user0).unstakeAndRedeemElpETH("299100000000000000000", expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("ElpManager: insufficient output")

    await rewardRouter.connect(user0).unstakeAndRedeemElpETH("299100000000000000000", "990000000000000000", receiver0.address)
    expect(await provider.getBalance(receiver0.address)).eq("994009000000000000") // 0.994009
    expect(await bnb.balanceOf(vault.address)).eq("5991000000000000") // 0.005991
    expect(await provider.getBalance(bnb.address)).eq("5991000000000000")
    expect(await bnb.totalSupply()).eq("5991000000000000")
  })
})
