const { expect, use } = require("chai")
require("@nomicfoundation/hardhat-chai-matchers");
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("../core/Vault/helpers")



describe("RewardRouterV2", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3, user4, tokenManager] = provider.getWallets()

  const vestingDuration = 365 * 24 * 60 * 60

  let timelock

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

  let eddxVester
  let elpVester

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

    timelock = await deployContract("Timelock", [
      wallet.address, // _admin
      10, // _buffer
      tokenManager.address, // _tokenManager
      tokenManager.address, // _mintReceiver
      elpManager.address, // _elpManager
      user0.address, // _rewardRouter
      expandDecimals(1000000, 18), // _maxTokenSupply
      10, // marginFeeBasisPoints
      100 // maxMarginFeeBasisPoints
    ])

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

    eddxVester = await deployContract("Vester", [
      "Vested EDDX", // _name
      "vEDDX", // _symbol
      vestingDuration, // _vestingDuration
      esEddx.address, // _esToken
      feeEddxTracker.address, // _pairToken
      eddx.address, // _claimableToken
      stakedEddxTracker.address, // _rewardTracker
    ])

    elpVester = await deployContract("Vester", [
      "Vested ELP", // _name
      "vELP", // _symbol
      vestingDuration, // _vestingDuration
      esEddx.address, // _esToken
      stakedElpTracker.address, // _pairToken
      eddx.address, // _claimableToken
      stakedElpTracker.address, // _rewardTracker
    ])

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

    await esEddx.setInPrivateTransferMode(true)

    rewardRouter = await deployContract("RewardRouterV2", [])
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
      elpManager.address,
      eddxVester.address,
      elpVester.address
    )

    // allow bonusEddxTracker to stake stakedEddxTracker
    await stakedEddxTracker.setHandler(bonusEddxTracker.address, true)
    // allow bonusEddxTracker to stake feeEddxTracker
    await bonusEddxTracker.setHandler(feeEddxTracker.address, true)
    await bonusEddxDistributor.setBonusMultiplier(10000)
    // allow feeEddxTracker to stake bnEddx
    await bnEddx.setHandler(feeEddxTracker.address, true)

    // allow stakedElpTracker to stake feeElpTracker
    await feeElpTracker.setHandler(stakedElpTracker.address, true)
    // allow feeElpTracker to stake elp
    await elp.setHandler(feeElpTracker.address, true)

    // mint esEddx for distributors
    await esEddx.setMinter(wallet.address, true)
    await esEddx.mint(stakedEddxDistributor.address, expandDecimals(50000, 18))
    await stakedEddxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esEddx per second
    await esEddx.mint(stakedElpDistributor.address, expandDecimals(50000, 18))
    await stakedElpDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esEddx per second

    // mint bnEddx for distributor
    await bnEddx.setMinter(wallet.address, true)
    await bnEddx.mint(bonusEddxDistributor.address, expandDecimals(1500, 18))

    await esEddx.setHandler(tokenManager.address, true)
    await eddxVester.setHandler(wallet.address, true)

    await esEddx.setHandler(rewardRouter.address, true)
    await esEddx.setHandler(stakedEddxDistributor.address, true)
    await esEddx.setHandler(stakedElpDistributor.address, true)
    await esEddx.setHandler(stakedEddxTracker.address, true)
    await esEddx.setHandler(stakedElpTracker.address, true)
    await esEddx.setHandler(eddxVester.address, true)
    await esEddx.setHandler(elpVester.address, true)

    await elpManager.setHandler(rewardRouter.address, true)
    await stakedEddxTracker.setHandler(rewardRouter.address, true)
    await bonusEddxTracker.setHandler(rewardRouter.address, true)
    await feeEddxTracker.setHandler(rewardRouter.address, true)
    await feeElpTracker.setHandler(rewardRouter.address, true)
    await stakedElpTracker.setHandler(rewardRouter.address, true)

    await esEddx.setHandler(rewardRouter.address, true)
    await bnEddx.setMinter(rewardRouter.address, true)
    await esEddx.setMinter(eddxVester.address, true)
    await esEddx.setMinter(elpVester.address, true)

    await eddxVester.setHandler(rewardRouter.address, true)
    await elpVester.setHandler(rewardRouter.address, true)

    await feeEddxTracker.setHandler(eddxVester.address, true)
    await stakedElpTracker.setHandler(elpVester.address, true)

    await elpManager.setGov(timelock.address)
    await stakedEddxTracker.setGov(timelock.address)
    await bonusEddxTracker.setGov(timelock.address)
    await feeEddxTracker.setGov(timelock.address)
    await feeElpTracker.setGov(timelock.address)
    await stakedElpTracker.setGov(timelock.address)
    await stakedEddxDistributor.setGov(timelock.address)
    await stakedElpDistributor.setGov(timelock.address)
    await esEddx.setGov(timelock.address)
    await bnEddx.setGov(timelock.address)
    await eddxVester.setGov(timelock.address)
    await elpVester.setGov(timelock.address)
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

    expect(await rewardRouter.eddxVester()).eq(eddxVester.address)
    expect(await rewardRouter.elpVester()).eq(elpVester.address)

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
      elpManager.address,
      eddxVester.address,
      elpVester.address
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

    await timelock.signalMint(esEddx.address, tokenManager.address, expandDecimals(500, 18))
    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.processMint(esEddx.address, tokenManager.address, expandDecimals(500, 18))
    await esEddx.connect(tokenManager).transferFrom(tokenManager.address, user2.address, expandDecimals(500, 18))
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

  it("eddx: signalTransfer, acceptTransfer", async () =>{
    await eddx.setMinter(wallet.address, true)
    await eddx.mint(user1.address, expandDecimals(200, 18))
    expect(await eddx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await eddx.connect(user1).approve(stakedEddxTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeEddx(expandDecimals(200, 18))
    expect(await eddx.balanceOf(user1.address)).eq(0)

    await eddx.mint(user2.address, expandDecimals(200, 18))
    expect(await eddx.balanceOf(user2.address)).eq(expandDecimals(200, 18))
    await eddx.connect(user2).approve(stakedEddxTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user2).stakeEddx(expandDecimals(200, 18))
    expect(await eddx.balanceOf(user2.address)).eq(0)

    await rewardRouter.connect(user2).signalTransfer(user1.address)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user2).signalTransfer(user1.address)
    await rewardRouter.connect(user1).claim()

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: stakedEddxTracker.averageStakedAmounts > 0")

    await rewardRouter.connect(user2).signalTransfer(user3.address)

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await eddxVester.setBonusRewards(user2.address, expandDecimals(100, 18))

    expect(await stakedEddxTracker.depositBalances(user2.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user2.address, esEddx.address)).eq(0)
    expect(await feeEddxTracker.depositBalances(user2.address, bnEddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user3.address, eddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user3.address, esEddx.address)).eq(0)
    expect(await feeEddxTracker.depositBalances(user3.address, bnEddx.address)).eq(0)
    expect(await eddxVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).eq(0)
    expect(await eddxVester.bonusRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.bonusRewards(user3.address)).eq(0)
    expect(await eddxVester.getCombinedAverageStakedAmount(user2.address)).eq(0)
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).eq(0)
    expect(await eddxVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await eddxVester.getPairAmount(user2.address, expandDecimals(892, 18))).eq(0)
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(892, 18))).eq(0)

    await rewardRouter.connect(user3).acceptTransfer(user2.address)

    expect(await stakedEddxTracker.depositBalances(user2.address, eddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user2.address, esEddx.address)).eq(0)
    expect(await feeEddxTracker.depositBalances(user2.address, bnEddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user3.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user3.address, esEddx.address)).gt(expandDecimals(892, 18))
    expect(await stakedEddxTracker.depositBalances(user3.address, esEddx.address)).lt(expandDecimals(893, 18))
    expect(await feeEddxTracker.depositBalances(user3.address, bnEddx.address)).gt("547000000000000000") // 0.547
    expect(await feeEddxTracker.depositBalances(user3.address, bnEddx.address)).lt("549000000000000000") // 0.548
    expect(await eddxVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await eddxVester.bonusRewards(user2.address)).eq(0)
    expect(await eddxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).eq(expandDecimals(200, 18))
    expect(await eddxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await eddxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(992, 18))
    expect(await eddxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(993, 18))
    expect(await eddxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))

    await eddx.connect(user3).approve(stakedEddxTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user3).signalTransfer(user4.address)
    await rewardRouter.connect(user4).acceptTransfer(user3.address)

    expect(await stakedEddxTracker.depositBalances(user3.address, eddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user3.address, esEddx.address)).eq(0)
    expect(await feeEddxTracker.depositBalances(user3.address, bnEddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user4.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user4.address, esEddx.address)).gt(expandDecimals(892, 18))
    expect(await stakedEddxTracker.depositBalances(user4.address, esEddx.address)).lt(expandDecimals(893, 18))
    expect(await feeEddxTracker.depositBalances(user4.address, bnEddx.address)).gt("547000000000000000") // 0.547
    expect(await feeEddxTracker.depositBalances(user4.address, bnEddx.address)).lt("549000000000000000") // 0.548
    expect(await eddxVester.transferredAverageStakedAmounts(user4.address)).gt(expandDecimals(200, 18))
    expect(await eddxVester.transferredAverageStakedAmounts(user4.address)).lt(expandDecimals(201, 18))
    expect(await eddxVester.transferredCumulativeRewards(user4.address)).gt(expandDecimals(892, 18))
    expect(await eddxVester.transferredCumulativeRewards(user4.address)).lt(expandDecimals(894, 18))
    expect(await eddxVester.bonusRewards(user3.address)).eq(0)
    expect(await eddxVester.bonusRewards(user4.address)).eq(expandDecimals(100, 18))
    expect(await stakedEddxTracker.averageStakedAmounts(user3.address)).gt(expandDecimals(1092, 18))
    expect(await stakedEddxTracker.averageStakedAmounts(user3.address)).lt(expandDecimals(1094, 18))
    expect(await eddxVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1094, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user4.address)).gt(expandDecimals(200, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user4.address)).lt(expandDecimals(201, 18))
    expect(await eddxVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await eddxVester.getMaxVestableAmount(user4.address)).gt(expandDecimals(992, 18))
    expect(await eddxVester.getMaxVestableAmount(user4.address)).lt(expandDecimals(993, 18))
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(992, 18))).eq(0)
    expect(await eddxVester.getPairAmount(user4.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await eddxVester.getPairAmount(user4.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))

    await expect(rewardRouter.connect(user4).acceptTransfer(user3.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")
  })

  it("eddx, elp: signalTransfer, acceptTransfer", async () =>{
    await eddx.setMinter(wallet.address, true)
    await eddx.mint(eddxVester.address, expandDecimals(10000, 18))
    await eddx.mint(elpVester.address, expandDecimals(10000, 18))
    await eth.mint(feeElpDistributor.address, expandDecimals(100, 18))
    await feeElpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(elpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user1).mintAndStakeElp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await bnb.mint(user2.address, expandDecimals(1, 18))
    await bnb.connect(user2).approve(elpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user2).mintAndStakeElp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await eddx.mint(user1.address, expandDecimals(200, 18))
    expect(await eddx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await eddx.connect(user1).approve(stakedEddxTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeEddx(expandDecimals(200, 18))
    expect(await eddx.balanceOf(user1.address)).eq(0)

    await eddx.mint(user2.address, expandDecimals(200, 18))
    expect(await eddx.balanceOf(user2.address)).eq(expandDecimals(200, 18))
    await eddx.connect(user2).approve(stakedEddxTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user2).stakeEddx(expandDecimals(200, 18))
    expect(await eddx.balanceOf(user2.address)).eq(0)

    await rewardRouter.connect(user2).signalTransfer(user1.address)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user2).signalTransfer(user1.address)
    await rewardRouter.connect(user1).compound()

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: stakedEddxTracker.averageStakedAmounts > 0")

    await rewardRouter.connect(user2).signalTransfer(user3.address)

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await eddxVester.setBonusRewards(user2.address, expandDecimals(100, 18))

    expect(await stakedEddxTracker.depositBalances(user2.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user2.address, esEddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user3.address, eddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user3.address, esEddx.address)).eq(0)

    expect(await feeEddxTracker.depositBalances(user2.address, bnEddx.address)).eq(0)
    expect(await feeEddxTracker.depositBalances(user3.address, bnEddx.address)).eq(0)

    expect(await feeElpTracker.depositBalances(user2.address, elp.address)).eq("299100000000000000000") // 299.1
    expect(await feeElpTracker.depositBalances(user3.address, elp.address)).eq(0)

    expect(await stakedElpTracker.depositBalances(user2.address, feeElpTracker.address)).eq("299100000000000000000") // 299.1
    expect(await stakedElpTracker.depositBalances(user3.address, feeElpTracker.address)).eq(0)

    expect(await eddxVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).eq(0)
    expect(await eddxVester.bonusRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.bonusRewards(user3.address)).eq(0)
    expect(await eddxVester.getCombinedAverageStakedAmount(user2.address)).eq(0)
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).eq(0)
    expect(await eddxVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await eddxVester.getPairAmount(user2.address, expandDecimals(892, 18))).eq(0)
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(892, 18))).eq(0)

    await rewardRouter.connect(user3).acceptTransfer(user2.address)

    expect(await stakedEddxTracker.depositBalances(user2.address, eddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user2.address, esEddx.address)).eq(0)
    expect(await stakedEddxTracker.depositBalances(user3.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user3.address, esEddx.address)).gt(expandDecimals(1785, 18))
    expect(await stakedEddxTracker.depositBalances(user3.address, esEddx.address)).lt(expandDecimals(1786, 18))

    expect(await feeEddxTracker.depositBalances(user2.address, bnEddx.address)).eq(0)
    expect(await feeEddxTracker.depositBalances(user3.address, bnEddx.address)).gt("547000000000000000") // 0.547
    expect(await feeEddxTracker.depositBalances(user3.address, bnEddx.address)).lt("549000000000000000") // 0.548

    expect(await feeElpTracker.depositBalances(user2.address, elp.address)).eq(0)
    expect(await feeElpTracker.depositBalances(user3.address, elp.address)).eq("299100000000000000000") // 299.1

    expect(await stakedElpTracker.depositBalances(user2.address, feeElpTracker.address)).eq(0)
    expect(await stakedElpTracker.depositBalances(user3.address, feeElpTracker.address)).eq("299100000000000000000") // 299.1

    expect(await eddxVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await eddxVester.bonusRewards(user2.address)).eq(0)
    expect(await eddxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).eq(expandDecimals(200, 18))
    expect(await eddxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await eddxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(992, 18))
    expect(await eddxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(993, 18))
    expect(await eddxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))
    expect(await eddxVester.getPairAmount(user1.address, expandDecimals(892, 18))).gt(expandDecimals(199, 18))
    expect(await eddxVester.getPairAmount(user1.address, expandDecimals(892, 18))).lt(expandDecimals(200, 18))

    await rewardRouter.connect(user1).compound()

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user1).claim()
    await rewardRouter.connect(user2).claim()
    await rewardRouter.connect(user3).claim()

    expect(await eddxVester.getCombinedAverageStakedAmount(user1.address)).gt(expandDecimals(1092, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user1.address)).lt(expandDecimals(1094, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1094, 18))

    expect(await eddxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await eddxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1885, 18))
    expect(await eddxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1887, 18))
    expect(await eddxVester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1785, 18))
    expect(await eddxVester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1787, 18))

    expect(await eddxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(1885, 18))).gt(expandDecimals(1092, 18))
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(1885, 18))).lt(expandDecimals(1094, 18))
    expect(await eddxVester.getPairAmount(user1.address, expandDecimals(1785, 18))).gt(expandDecimals(1092, 18))
    expect(await eddxVester.getPairAmount(user1.address, expandDecimals(1785, 18))).lt(expandDecimals(1094, 18))

    await rewardRouter.connect(user1).compound()
    await rewardRouter.connect(user3).compound()

    expect(await feeEddxTracker.balanceOf(user1.address)).gt(expandDecimals(1992, 18))
    expect(await feeEddxTracker.balanceOf(user1.address)).lt(expandDecimals(1993, 18))

    await eddxVester.connect(user1).deposit(expandDecimals(1785, 18))

    expect(await feeEddxTracker.balanceOf(user1.address)).gt(expandDecimals(1991 - 1092, 18)) // 899
    expect(await feeEddxTracker.balanceOf(user1.address)).lt(expandDecimals(1993 - 1092, 18)) // 901

    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt(expandDecimals(4, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt(expandDecimals(6, 18))

    await rewardRouter.connect(user1).unstakeEddx(expandDecimals(200, 18))
    await expect(rewardRouter.connect(user1).unstakeEsEddx(expandDecimals(699, 18)))
      .to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await rewardRouter.connect(user1).unstakeEsEddx(expandDecimals(599, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await feeEddxTracker.balanceOf(user1.address)).gt(expandDecimals(97, 18))
    expect(await feeEddxTracker.balanceOf(user1.address)).lt(expandDecimals(99, 18))

    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(599, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(601, 18))

    expect(await eddx.balanceOf(user1.address)).eq(expandDecimals(200, 18))

    await eddxVester.connect(user1).withdraw()

    expect(await feeEddxTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18)) // 1190 - 98 => 1092
    expect(await feeEddxTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(2378, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(2380, 18))

    expect(await eddx.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await eddx.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    expect(await elpVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1785, 18))
    expect(await elpVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1787, 18))

    expect(await elpVester.getPairAmount(user3.address, expandDecimals(1785, 18))).gt(expandDecimals(298, 18))
    expect(await elpVester.getPairAmount(user3.address, expandDecimals(1785, 18))).lt(expandDecimals(300, 18))

    expect(await stakedElpTracker.balanceOf(user3.address)).eq("299100000000000000000")

    expect(await esEddx.balanceOf(user3.address)).gt(expandDecimals(1785, 18))
    expect(await esEddx.balanceOf(user3.address)).lt(expandDecimals(1787, 18))

    expect(await eddx.balanceOf(user3.address)).eq(0)

    await elpVester.connect(user3).deposit(expandDecimals(1785, 18))

    expect(await stakedElpTracker.balanceOf(user3.address)).gt(0)
    expect(await stakedElpTracker.balanceOf(user3.address)).lt(expandDecimals(1, 18))

    expect(await esEddx.balanceOf(user3.address)).gt(0)
    expect(await esEddx.balanceOf(user3.address)).lt(expandDecimals(1, 18))

    expect(await eddx.balanceOf(user3.address)).eq(0)

    await expect(rewardRouter.connect(user3).unstakeAndRedeemElp(
      bnb.address,
      expandDecimals(1, 18),
      0,
      user3.address
    )).to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await elpVester.connect(user3).withdraw()

    expect(await stakedElpTracker.balanceOf(user3.address)).eq("299100000000000000000")

    expect(await esEddx.balanceOf(user3.address)).gt(expandDecimals(1785 - 5, 18))
    expect(await esEddx.balanceOf(user3.address)).lt(expandDecimals(1787 - 5, 18))

    expect(await eddx.balanceOf(user3.address)).gt(expandDecimals(4, 18))
    expect(await eddx.balanceOf(user3.address)).lt(expandDecimals(6, 18))

    expect(await feeEddxTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18))
    expect(await feeEddxTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(2379, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(2381, 18))

    expect(await eddx.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await eddx.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    await eddxVester.connect(user1).deposit(expandDecimals(365 * 2, 18))

    expect(await feeEddxTracker.balanceOf(user1.address)).gt(expandDecimals(743, 18)) // 1190 - 743 => 447
    expect(await feeEddxTracker.balanceOf(user1.address)).lt(expandDecimals(754, 18))

    expect(await eddxVester.claimable(user1.address)).eq(0)

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await eddxVester.claimable(user1.address)).gt("3900000000000000000") // 3.9
    expect(await eddxVester.claimable(user1.address)).lt("4100000000000000000") // 4.1

    await eddxVester.connect(user1).deposit(expandDecimals(365, 18))

    expect(await feeEddxTracker.balanceOf(user1.address)).gt(expandDecimals(522, 18)) // 743 - 522 => 221
    expect(await feeEddxTracker.balanceOf(user1.address)).lt(expandDecimals(524, 18))

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await eddxVester.claimable(user1.address)).gt("9900000000000000000") // 9.9
    expect(await eddxVester.claimable(user1.address)).lt("10100000000000000000") // 10.1

    expect(await eddx.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await eddx.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    await eddxVester.connect(user1).claim()

    expect(await eddx.balanceOf(user1.address)).gt(expandDecimals(214, 18))
    expect(await eddx.balanceOf(user1.address)).lt(expandDecimals(216, 18))

    await eddxVester.connect(user1).deposit(expandDecimals(365, 18))
    expect(await eddxVester.balanceOf(user1.address)).gt(expandDecimals(1449, 18)) // 365 * 4 => 1460, 1460 - 10 => 1450
    expect(await eddxVester.balanceOf(user1.address)).lt(expandDecimals(1451, 18))
    expect(await eddxVester.getVestedAmount(user1.address)).eq(expandDecimals(1460, 18))

    expect(await feeEddxTracker.balanceOf(user1.address)).gt(expandDecimals(303, 18)) // 522 - 303 => 219
    expect(await feeEddxTracker.balanceOf(user1.address)).lt(expandDecimals(304, 18))

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await eddxVester.claimable(user1.address)).gt("7900000000000000000") // 7.9
    expect(await eddxVester.claimable(user1.address)).lt("8100000000000000000") // 8.1

    await eddxVester.connect(user1).withdraw()

    expect(await feeEddxTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18))
    expect(await feeEddxTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await eddx.balanceOf(user1.address)).gt(expandDecimals(222, 18))
    expect(await eddx.balanceOf(user1.address)).lt(expandDecimals(224, 18))

    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(2360, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(2362, 18))

    await eddxVester.connect(user1).deposit(expandDecimals(365, 18))

    await increaseTime(provider, 500 * 24 * 60 * 60)
    await mineBlock(provider)

    expect(await eddxVester.claimable(user1.address)).eq(expandDecimals(365, 18))

    await eddxVester.connect(user1).withdraw()

    expect(await eddx.balanceOf(user1.address)).gt(expandDecimals(222 + 365, 18))
    expect(await eddx.balanceOf(user1.address)).lt(expandDecimals(224 + 365, 18))

    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(2360 - 365, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(2362 - 365, 18))

    expect(await eddxVester.transferredAverageStakedAmounts(user2.address)).eq(0)
    expect(await eddxVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.cumulativeRewards(user2.address)).gt(expandDecimals(892, 18))
    expect(await stakedEddxTracker.cumulativeRewards(user2.address)).lt(expandDecimals(893, 18))
    expect(await stakedEddxTracker.cumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await stakedEddxTracker.cumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await eddxVester.bonusRewards(user2.address)).eq(0)
    expect(await eddxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1093, 18))
    expect(await eddxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await eddxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1884, 18))
    expect(await eddxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1886, 18))
    expect(await eddxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(574, 18))
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(575, 18))
    expect(await eddxVester.getPairAmount(user1.address, expandDecimals(892, 18))).gt(expandDecimals(545, 18))
    expect(await eddxVester.getPairAmount(user1.address, expandDecimals(892, 18))).lt(expandDecimals(546, 18))

    const esEddxBatchSender = await deployContract("EsEddxBatchSender", [esEddx.address])

    await timelock.signalSetHandler(esEddx.address, esEddxBatchSender.address, true)
    await timelock.signalSetHandler(eddxVester.address, esEddxBatchSender.address, true)
    await timelock.signalSetHandler(elpVester.address, esEddxBatchSender.address, true)
    await timelock.signalMint(esEddx.address, wallet.address, expandDecimals(1000, 18))

    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.setHandler(esEddx.address, esEddxBatchSender.address, true)
    await timelock.setHandler(eddxVester.address, esEddxBatchSender.address, true)
    await timelock.setHandler(elpVester.address, esEddxBatchSender.address, true)
    await timelock.processMint(esEddx.address, wallet.address, expandDecimals(1000, 18))

    await esEddxBatchSender.connect(wallet).send(
      eddxVester.address,
      4,
      [user2.address, user3.address],
      [expandDecimals(100, 18), expandDecimals(200, 18)]
    )

    expect(await eddxVester.transferredAverageStakedAmounts(user2.address)).gt(expandDecimals(37648, 18))
    expect(await eddxVester.transferredAverageStakedAmounts(user2.address)).lt(expandDecimals(37649, 18))
    expect(await eddxVester.transferredAverageStakedAmounts(user3.address)).gt(expandDecimals(12810, 18))
    expect(await eddxVester.transferredAverageStakedAmounts(user3.address)).lt(expandDecimals(12811, 18))
    expect(await eddxVester.transferredCumulativeRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892 + 200, 18))
    expect(await eddxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893 + 200, 18))
    expect(await eddxVester.bonusRewards(user2.address)).eq(0)
    expect(await eddxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user2.address)).gt(expandDecimals(3971, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user2.address)).lt(expandDecimals(3972, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(7943, 18))
    expect(await eddxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(7944, 18))
    expect(await eddxVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await eddxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1884 + 200, 18))
    expect(await eddxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1886 + 200, 18))
    expect(await eddxVester.getPairAmount(user2.address, expandDecimals(100, 18))).gt(expandDecimals(3971, 18))
    expect(await eddxVester.getPairAmount(user2.address, expandDecimals(100, 18))).lt(expandDecimals(3972, 18))
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(1884 + 200, 18))).gt(expandDecimals(7936, 18))
    expect(await eddxVester.getPairAmount(user3.address, expandDecimals(1884 + 200, 18))).lt(expandDecimals(7937, 18))

    expect(await elpVester.transferredAverageStakedAmounts(user4.address)).eq(0)
    expect(await elpVester.transferredCumulativeRewards(user4.address)).eq(0)
    expect(await elpVester.bonusRewards(user4.address)).eq(0)
    expect(await elpVester.getCombinedAverageStakedAmount(user4.address)).eq(0)
    expect(await elpVester.getMaxVestableAmount(user4.address)).eq(0)
    expect(await elpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(0)

    await esEddxBatchSender.connect(wallet).send(
      elpVester.address,
      320,
      [user4.address],
      [expandDecimals(10, 18)]
    )

    expect(await elpVester.transferredAverageStakedAmounts(user4.address)).eq(expandDecimals(3200, 18))
    expect(await elpVester.transferredCumulativeRewards(user4.address)).eq(expandDecimals(10, 18))
    expect(await elpVester.bonusRewards(user4.address)).eq(0)
    expect(await elpVester.getCombinedAverageStakedAmount(user4.address)).eq(expandDecimals(3200, 18))
    expect(await elpVester.getMaxVestableAmount(user4.address)).eq(expandDecimals(10, 18))
    expect(await elpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(expandDecimals(3200, 18))

    await esEddxBatchSender.connect(wallet).send(
      elpVester.address,
      320,
      [user4.address],
      [expandDecimals(10, 18)]
    )

    expect(await elpVester.transferredAverageStakedAmounts(user4.address)).eq(expandDecimals(6400, 18))
    expect(await elpVester.transferredCumulativeRewards(user4.address)).eq(expandDecimals(20, 18))
    expect(await elpVester.bonusRewards(user4.address)).eq(0)
    expect(await elpVester.getCombinedAverageStakedAmount(user4.address)).eq(expandDecimals(6400, 18))
    expect(await elpVester.getMaxVestableAmount(user4.address)).eq(expandDecimals(20, 18))
    expect(await elpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(expandDecimals(3200, 18))
  })

  it("handleRewards", async () => {
    const timelockV2 = wallet

    // use new rewardRouter, use eth for weth
    const rewardRouterV2 = await deployContract("RewardRouterV2", [])
    await rewardRouterV2.initialize(
      eth.address,
      eddx.address,
      esEddx.address,
      bnEddx.address,
      elp.address,
      stakedEddxTracker.address,
      bonusEddxTracker.address,
      feeEddxTracker.address,
      feeElpTracker.address,
      stakedElpTracker.address,
      elpManager.address,
      eddxVester.address,
      elpVester.address
    )

    await timelock.signalSetGov(elpManager.address, timelockV2.address)
    await timelock.signalSetGov(stakedEddxTracker.address, timelockV2.address)
    await timelock.signalSetGov(bonusEddxTracker.address, timelockV2.address)
    await timelock.signalSetGov(feeEddxTracker.address, timelockV2.address)
    await timelock.signalSetGov(feeElpTracker.address, timelockV2.address)
    await timelock.signalSetGov(stakedElpTracker.address, timelockV2.address)
    await timelock.signalSetGov(stakedEddxDistributor.address, timelockV2.address)
    await timelock.signalSetGov(stakedElpDistributor.address, timelockV2.address)
    await timelock.signalSetGov(esEddx.address, timelockV2.address)
    await timelock.signalSetGov(bnEddx.address, timelockV2.address)
    await timelock.signalSetGov(eddxVester.address, timelockV2.address)
    await timelock.signalSetGov(elpVester.address, timelockV2.address)

    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.setGov(elpManager.address, timelockV2.address)
    await timelock.setGov(stakedEddxTracker.address, timelockV2.address)
    await timelock.setGov(bonusEddxTracker.address, timelockV2.address)
    await timelock.setGov(feeEddxTracker.address, timelockV2.address)
    await timelock.setGov(feeElpTracker.address, timelockV2.address)
    await timelock.setGov(stakedElpTracker.address, timelockV2.address)
    await timelock.setGov(stakedEddxDistributor.address, timelockV2.address)
    await timelock.setGov(stakedElpDistributor.address, timelockV2.address)
    await timelock.setGov(esEddx.address, timelockV2.address)
    await timelock.setGov(bnEddx.address, timelockV2.address)
    await timelock.setGov(eddxVester.address, timelockV2.address)
    await timelock.setGov(elpVester.address, timelockV2.address)

    await esEddx.setHandler(rewardRouterV2.address, true)
    await esEddx.setHandler(stakedEddxDistributor.address, true)
    await esEddx.setHandler(stakedElpDistributor.address, true)
    await esEddx.setHandler(stakedEddxTracker.address, true)
    await esEddx.setHandler(stakedElpTracker.address, true)
    await esEddx.setHandler(eddxVester.address, true)
    await esEddx.setHandler(elpVester.address, true)

    await elpManager.setHandler(rewardRouterV2.address, true)
    await stakedEddxTracker.setHandler(rewardRouterV2.address, true)
    await bonusEddxTracker.setHandler(rewardRouterV2.address, true)
    await feeEddxTracker.setHandler(rewardRouterV2.address, true)
    await feeElpTracker.setHandler(rewardRouterV2.address, true)
    await stakedElpTracker.setHandler(rewardRouterV2.address, true)

    await esEddx.setHandler(rewardRouterV2.address, true)
    await bnEddx.setMinter(rewardRouterV2.address, true)
    await esEddx.setMinter(eddxVester.address, true)
    await esEddx.setMinter(elpVester.address, true)

    await eddxVester.setHandler(rewardRouterV2.address, true)
    await elpVester.setHandler(rewardRouterV2.address, true)

    await feeEddxTracker.setHandler(eddxVester.address, true)
    await stakedElpTracker.setHandler(elpVester.address, true)

    await eth.deposit({ value: expandDecimals(10, 18) })

    await eddx.setMinter(wallet.address, true)
    await eddx.mint(eddxVester.address, expandDecimals(10000, 18))
    await eddx.mint(elpVester.address, expandDecimals(10000, 18))

    await eth.mint(feeElpDistributor.address, expandDecimals(50, 18))
    await feeElpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await eth.mint(feeEddxDistributor.address, expandDecimals(50, 18))
    await feeEddxDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(elpManager.address, expandDecimals(1, 18))
    await rewardRouterV2.connect(user1).mintAndStakeElp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await eddx.mint(user1.address, expandDecimals(200, 18))
    expect(await eddx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await eddx.connect(user1).approve(stakedEddxTracker.address, expandDecimals(200, 18))
    await rewardRouterV2.connect(user1).stakeEddx(expandDecimals(200, 18))
    expect(await eddx.balanceOf(user1.address)).eq(0)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await eddx.balanceOf(user1.address)).eq(0)
    expect(await esEddx.balanceOf(user1.address)).eq(0)
    expect(await bnEddx.balanceOf(user1.address)).eq(0)
    expect(await elp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).eq(0)

    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).eq(0)
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).eq(0)

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimEddx
      true, // _shouldStakeEddx
      true, // _shouldClaimEsEddx
      true, // _shouldStakeEsEddx
      true, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    )

    expect(await eddx.balanceOf(user1.address)).eq(0)
    expect(await esEddx.balanceOf(user1.address)).eq(0)
    expect(await bnEddx.balanceOf(user1.address)).eq(0)
    expect(await elp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).lt(expandDecimals(3572, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt("540000000000000000") // 0.54
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt("560000000000000000") // 0.56

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const ethBalance0 = await provider.getBalance(user1.address)

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimEddx
      false, // _shouldStakeEddx
      false, // _shouldClaimEsEddx
      false, // _shouldStakeEsEddx
      false, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      true // _shouldConvertWethToEth
    )

    const ethBalance1 = await provider.getBalance(user1.address)

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await eddx.balanceOf(user1.address)).eq(0)
    expect(await esEddx.balanceOf(user1.address)).eq(0)
    expect(await bnEddx.balanceOf(user1.address)).eq(0)
    expect(await elp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).lt(expandDecimals(3572, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt("540000000000000000") // 0.54
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt("560000000000000000") // 0.56

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimEddx
      false, // _shouldStakeEddx
      true, // _shouldClaimEsEddx
      false, // _shouldStakeEsEddx
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    )

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await eddx.balanceOf(user1.address)).eq(0)
    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(3571, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(3572, 18))
    expect(await bnEddx.balanceOf(user1.address)).eq(0)
    expect(await elp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).lt(expandDecimals(3572, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt("540000000000000000") // 0.54
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt("560000000000000000") // 0.56

    await eddxVester.connect(user1).deposit(expandDecimals(365, 18))
    await elpVester.connect(user1).deposit(expandDecimals(365 * 2, 18))

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await eddx.balanceOf(user1.address)).eq(0)
    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(3571 - 365 * 3, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(3572 - 365 * 3, 18))
    expect(await bnEddx.balanceOf(user1.address)).eq(0)
    expect(await elp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).lt(expandDecimals(3572, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt("540000000000000000") // 0.54
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt("560000000000000000") // 0.56

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimEddx
      false, // _shouldStakeEddx
      false, // _shouldClaimEsEddx
      false, // _shouldStakeEsEddx
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    )

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await eddx.balanceOf(user1.address)).gt("2900000000000000000") // 2.9
    expect(await eddx.balanceOf(user1.address)).lt("3100000000000000000") // 3.1
    expect(await esEddx.balanceOf(user1.address)).gt(expandDecimals(3571 - 365 * 3, 18))
    expect(await esEddx.balanceOf(user1.address)).lt(expandDecimals(3572 - 365 * 3, 18))
    expect(await bnEddx.balanceOf(user1.address)).eq(0)
    expect(await elp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedEddxTracker.depositBalances(user1.address, eddx.address)).eq(expandDecimals(200, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedEddxTracker.depositBalances(user1.address, esEddx.address)).lt(expandDecimals(3572, 18))
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).gt("540000000000000000") // 0.54
    expect(await feeEddxTracker.depositBalances(user1.address, bnEddx.address)).lt("560000000000000000") // 0.56
  })

  it("StakedElp", async () => {
    await eth.mint(feeElpDistributor.address, expandDecimals(100, 18))
    await feeElpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(elpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user1).mintAndStakeElp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeElpTracker.depositBalances(user1.address, elp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedElpTracker.depositBalances(user1.address, feeElpTracker.address)).eq(expandDecimals(2991, 17))

    const stakedElp = await deployContract("StakedElp", [elp.address, elpManager.address, stakedElpTracker.address, feeElpTracker.address])

    await expect(stakedElp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("StakedElp: transfer amount exceeds allowance")

    await stakedElp.connect(user1).approve(user2.address, expandDecimals(2991, 17))

    await expect(stakedElp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("StakedElp: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(stakedElp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await timelock.signalSetHandler(stakedElpTracker.address, stakedElp.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(stakedElpTracker.address, stakedElp.address, true)

    await expect(stakedElp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await timelock.signalSetHandler(feeElpTracker.address, stakedElp.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(feeElpTracker.address, stakedElp.address, true)

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeElpTracker.depositBalances(user1.address, elp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedElpTracker.depositBalances(user1.address, feeElpTracker.address)).eq(expandDecimals(2991, 17))

    expect(await feeElpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeElpTracker.depositBalances(user3.address, elp.address)).eq(0)

    expect(await stakedElpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedElpTracker.depositBalances(user3.address, feeElpTracker.address)).eq(0)

    await stakedElp.connect(user2).transferFrom(user1.address, user3. address, expandDecimals(2991, 17))

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq(0)
    expect(await feeElpTracker.depositBalances(user1.address, elp.address)).eq(0)

    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq(0)
    expect(await stakedElpTracker.depositBalances(user1.address, feeElpTracker.address)).eq(0)

    expect(await feeElpTracker.stakedAmounts(user3.address)).eq(expandDecimals(2991, 17))
    expect(await feeElpTracker.depositBalances(user3.address, elp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedElpTracker.stakedAmounts(user3.address)).eq(expandDecimals(2991, 17))
    expect(await stakedElpTracker.depositBalances(user3.address, feeElpTracker.address)).eq(expandDecimals(2991, 17))

    await expect(stakedElp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(3000, 17)))
      .to.be.revertedWith("StakedElp: transfer amount exceeds allowance")

    await stakedElp.connect(user3).approve(user2.address, expandDecimals(3000, 17))

    await expect(stakedElp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(3000, 17)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    await stakedElp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(1000, 17))

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 17))
    expect(await feeElpTracker.depositBalances(user1.address, elp.address)).eq(expandDecimals(1000, 17))

    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 17))
    expect(await stakedElpTracker.depositBalances(user1.address, feeElpTracker.address)).eq(expandDecimals(1000, 17))

    expect(await feeElpTracker.stakedAmounts(user3.address)).eq(expandDecimals(1991, 17))
    expect(await feeElpTracker.depositBalances(user3.address, elp.address)).eq(expandDecimals(1991, 17))

    expect(await stakedElpTracker.stakedAmounts(user3.address)).eq(expandDecimals(1991, 17))
    expect(await stakedElpTracker.depositBalances(user3.address, feeElpTracker.address)).eq(expandDecimals(1991, 17))

    await stakedElp.connect(user3).transfer(user1.address, expandDecimals(1500, 17))

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2500, 17))
    expect(await feeElpTracker.depositBalances(user1.address, elp.address)).eq(expandDecimals(2500, 17))

    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2500, 17))
    expect(await stakedElpTracker.depositBalances(user1.address, feeElpTracker.address)).eq(expandDecimals(2500, 17))

    expect(await feeElpTracker.stakedAmounts(user3.address)).eq(expandDecimals(491, 17))
    expect(await feeElpTracker.depositBalances(user3.address, elp.address)).eq(expandDecimals(491, 17))

    expect(await stakedElpTracker.stakedAmounts(user3.address)).eq(expandDecimals(491, 17))
    expect(await stakedElpTracker.depositBalances(user3.address, feeElpTracker.address)).eq(expandDecimals(491, 17))

    await expect(stakedElp.connect(user3).transfer(user1.address, expandDecimals(492, 17)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    expect(await bnb.balanceOf(user1.address)).eq(0)

    await rewardRouter.connect(user1).unstakeAndRedeemElp(
      bnb.address,
      expandDecimals(2500, 17),
      "830000000000000000", // 0.83
      user1.address
    )

    expect(await bnb.balanceOf(user1.address)).eq("830833333333333333")

    await usdg.addVault(elpManager.address)

    expect(await bnb.balanceOf(user3.address)).eq("0")

    await rewardRouter.connect(user3).unstakeAndRedeemElp(
      bnb.address,
      expandDecimals(491, 17),
      "160000000000000000", // 0.16
      user3.address
    )

    expect(await bnb.balanceOf(user3.address)).eq("163175666666666666")
  })

  it("FeeElp", async () => {
    await eth.mint(feeElpDistributor.address, expandDecimals(100, 18))
    await feeElpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(elpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user1).mintAndStakeElp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeElpTracker.depositBalances(user1.address, elp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedElpTracker.depositBalances(user1.address, feeElpTracker.address)).eq(expandDecimals(2991, 17))

    const elpBalance = await deployContract("ElpBalance", [elpManager.address, stakedElpTracker.address])

    await expect(elpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("ElpBalance: transfer amount exceeds allowance")

    await elpBalance.connect(user1).approve(user2.address, expandDecimals(2991, 17))

    await expect(elpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("ElpBalance: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(elpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds allowance")

    await timelock.signalSetHandler(stakedElpTracker.address, elpBalance.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(stakedElpTracker.address, elpBalance.address, true)

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeElpTracker.depositBalances(user1.address, elp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedElpTracker.depositBalances(user1.address, feeElpTracker.address)).eq(expandDecimals(2991, 17))
    expect(await stakedElpTracker.balanceOf(user1.address)).eq(expandDecimals(2991, 17))

    expect(await feeElpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeElpTracker.depositBalances(user3.address, elp.address)).eq(0)

    expect(await stakedElpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedElpTracker.depositBalances(user3.address, feeElpTracker.address)).eq(0)
    expect(await stakedElpTracker.balanceOf(user3.address)).eq(0)

    await elpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17))

    expect(await feeElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeElpTracker.depositBalances(user1.address, elp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedElpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedElpTracker.depositBalances(user1.address, feeElpTracker.address)).eq(expandDecimals(2991, 17))
    expect(await stakedElpTracker.balanceOf(user1.address)).eq(0)

    expect(await feeElpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeElpTracker.depositBalances(user3.address, elp.address)).eq(0)

    expect(await stakedElpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedElpTracker.depositBalances(user3.address, feeElpTracker.address)).eq(0)
    expect(await stakedElpTracker.balanceOf(user3.address)).eq(expandDecimals(2991, 17))

    await expect(rewardRouter.connect(user1).unstakeAndRedeemElp(
      bnb.address,
      expandDecimals(2991, 17),
      "0",
      user1.address
    )).to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await elpBalance.connect(user3).approve(user2.address, expandDecimals(3000, 17))

    await expect(elpBalance.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(2992, 17)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")

    await elpBalance.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(2991, 17))

    expect(await bnb.balanceOf(user1.address)).eq(0)

    await rewardRouter.connect(user1).unstakeAndRedeemElp(
      bnb.address,
      expandDecimals(2991, 17),
      "0",
      user1.address
    )

    expect(await bnb.balanceOf(user1.address)).eq("994009000000000000")
  })
})
