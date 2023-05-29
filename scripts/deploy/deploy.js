const {deployContract, contractAt, sendTxn, writeTmpAddresses } = require("../shared/helpers")
const {expandDecimals, bigNumberify} = require("../../test/shared/utilities")
const {toUsd} = require("../../test/shared/units")
const {errors} = require("../../test/core/Vault/helpers")
const contractBase = require("../../.contract-base.json")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')['base'];
const gasLimit = 12500000;
const { AddressZero } = ethers.constants

async function main() {
  const {nativeToken} = tokens
  const deployer = {address: "0xcb5A899FfcB0049BDeF4205694DCCCE29cbFf21F"}
  const weth = await contractAt("WETH",nativeToken.address)
  const buffer = 24 * 60 * 60
  const maxTokenSupply = expandDecimals("500000000", 18)


  const signers = [deployer.address]
  const updaters = [deployer.address]

  const orderKeepers = [
    { address: deployer.address }
  ]
  const liquidators = [
    { address: deployer.address }
  ]

  const partnerContracts = [deployer.address]

  let vault;
  if(contractBase.vault){
     vault = await contractAt("Vault", contractBase.vault)
  }else{
    vault = await deployContract("Vault", [])
    writeTmpAddresses({vault: vault.address})
  }

  let usdg;
  if(contractBase.usdg){
    usdg = await contractAt("USDG", contractBase.usdg)
  }else {
    usdg = await deployContract("USDG", [vault.address])
    writeTmpAddresses({usdg: usdg.address})
  }

  let router;
  if(contractBase.router){
    router = await contractAt("Router", contractBase.router)
  }else{
    router = await deployContract("Router", [vault.address, usdg.address, nativeToken.address])
    writeTmpAddresses({router: router.address})
  }

  let vaultPriceFeed;
  if(contractBase.vaultPriceFeed){
    vaultPriceFeed = await contractAt("VaultPriceFeed", contractBase.vaultPriceFeed)
  }else {
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])
    writeTmpAddresses({vaultPriceFeed: vaultPriceFeed.address})
    await sendTxn(vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 28)), "vaultPriceFeed.setMaxStrictPriceDeviation")
    await sendTxn(vaultPriceFeed.setPriceSampleSpace(1), "vaultPriceFeed.setPriceSampleSpace")
    await sendTxn(vaultPriceFeed.setIsAmmEnabled(false), "vaultPriceFeed.setIsAmmEnabled")
  }

  let elp;
  if(contractBase.elp){
    elp = await contractAt("ELP", contractBase.elp)
  }else {
    elp = await deployContract("ELP", [])
    writeTmpAddresses({elp: elp.address})

    await sendTxn(elp.setInPrivateTransferMode(true), "elp.setInPrivateTransferMode")
  }

  let shortsTracker;
  if(contractBase.shortsTracker){
    shortsTracker = await contractAt("ShortsTracker", contractBase.shortsTracker)
  }else {
    shortsTracker = await deployContract("ShortsTracker", [vault.address], "ShortsTracker", {gasLimit})
    writeTmpAddresses({shortsTracker: shortsTracker.address})
  }

  let elpManager;
  if(contractBase.elpManager){
    elpManager = await contractAt("ElpManager", contractBase.elpManager)
  }else {
    elpManager = await deployContract("ElpManager", [vault.address, usdg.address, elp.address, shortsTracker.address, 15 * 60])
    writeTmpAddresses({elpManager: elpManager.address})

    await sendTxn(elpManager.setInPrivateMode(true), "elpManager.setInPrivateMode")

    await sendTxn(elp.setMinter(elpManager.address, true), "elp.setMinter")
    await sendTxn(usdg.addVault(elpManager.address), "usdg.addVault(elpManager)")

    await sendTxn(vault.initialize(
      router.address, // router
      usdg.address, // usdg
      vaultPriceFeed.address, // priceFeed
      toUsd(2), // liquidationFeeUsd
      100, // fundingRateFactor
      100 // stableFundingRateFactor
    ), "vault.initialize")

    await sendTxn(vault.setFundingRate(60 * 60, 100, 100), "vault.setFundingRate")

    await sendTxn(vault.setInManagerMode(true), "vault.setInManagerMode")
    await sendTxn(vault.setManager(elpManager.address, true), "vault.setManager")

    await sendTxn(vault.setFees(
      10, // _taxBasisPoints
      5, // _stableTaxBasisPoints
      20, // _mintBurnFeeBasisPoints
      20, // _swapFeeBasisPoints
      1, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(2), // _liquidationFeeUsd
      24 * 60 * 60, // _minProfitTime
      true // _hasDynamicFees
    ), "vault.setFees")
  }

  let vaultErrorController;
  if(contractBase.vaultErrorController){
    vaultErrorController = await contractAt("VaultErrorController", contractBase.vaultErrorController)
  }else {
    vaultErrorController = await deployContract("VaultErrorController", [])
    writeTmpAddresses({vaultErrorController: vaultErrorController.address})

    await sendTxn(vault.setErrorController(vaultErrorController.address), "vault.setErrorController")
    await sendTxn(vaultErrorController.setErrors(vault.address, errors), "vaultErrorController.setErrors")
  }

  let vaultUtils;
  if(contractBase.vaultUtils){
    vaultUtils = await contractAt("VaultUtils", contractBase.vaultUtils)
  }else {
    vaultUtils = await deployContract("VaultUtils", [vault.address])
    writeTmpAddresses({vaultUtils: vaultUtils.address})

    await sendTxn(vault.setVaultUtils(vaultUtils.address), "vault.setVaultUtils")
  }

  let orderBook;
  if(contractBase.orderBook){
    orderBook = await contractAt("OrderBook", contractBase.orderBook)
  }else {
    orderBook = await deployContract("OrderBook", []);
    writeTmpAddresses({orderBook: orderBook.address})

    await sendTxn(orderBook.initialize(
      router.address, // router
      vault.address, // vault
      nativeToken.address, // weth
      usdg.address, // usdg
      "10000000000000000", // 0.01 BASE
      expandDecimals(10, 30) // min purchase token amount usd
    ), "orderBook.initialize");
  }

  let referralReader;
  if(contractBase.referralReader){
    referralReader = await contractAt("ReferralReader", contractBase.referralReader)
  }else {
    referralReader = await deployContract("ReferralReader", [], "ReferralReader")
    writeTmpAddresses({referralReader: referralReader.address})
  }

  let referralStorage;
  if(contractBase.referralStorage){
    referralStorage = await contractAt("ReferralStorage", contractBase.referralStorage)
  }else {
    referralStorage = await deployContract("ReferralStorage", [])
    writeTmpAddresses({referralStorage: referralStorage.address})

    await sendTxn(referralStorage.setTier(0, 1000, 5000), "referralStorage.setTier 0")
    await sendTxn(referralStorage.setTier(1, 2000, 5000), "referralStorage.setTier 1")
    await sendTxn(referralStorage.setTier(2, 2500, 4000), "referralStorage.setTier 2")
  }

  let positionUtils;
  if(contractBase.positionUtils){
    positionUtils = await contractAt("PositionUtils", contractBase.positionUtils)
  }else {
    positionUtils = await deployContract("PositionUtils", [])
    writeTmpAddresses({positionUtils: positionUtils.address})
  }

  const depositFee = "30" // 0.3%
  const minExecutionFee = "10000000000000000" // 0.01 ETH
  const positionRouterArgs = [vault.address, router.address, nativeToken.address, shortsTracker.address, depositFee, minExecutionFee]

  let positionRouter;
  if(contractBase.positionRouter){
    positionRouter = await contractAt("PositionRouter",contractBase.positionRouter,null,{
      libraries: {
        PositionUtils: positionUtils.address
      }
    })
  }else {
    positionRouter = await deployContract("PositionRouter", positionRouterArgs, "PositionRouter", {
      libraries: {
        PositionUtils: positionUtils.address
      }
    })
    writeTmpAddresses({positionRouter: positionRouter.address})


    await sendTxn(positionRouter.setPositionKeeper(deployer.address, true), "positionRouter.setPositionKeeper(deployer)")
    await sendTxn(positionRouter.setReferralStorage(referralStorage.address), "positionRouter.setReferralStorage")
    await sendTxn(referralStorage.setHandler(positionRouter.address, true), "ReferralStorage setHandler positionRouter");
    await sendTxn(router.addPlugin(positionRouter.address), "router.addPlugin")
    await sendTxn(positionRouter.setDelayValues(0, 180, 30 * 60), "positionRouter.setDelayValues")
    await sendTxn(shortsTracker.setHandler(positionRouter.address, true), "shortsTracker.setContractHandler(positionRouter.address, true)")
    await sendTxn(positionRouter.setGov(await vault.gov()), "positionRouter.setGov")
    await sendTxn(positionRouter.setAdmin(deployer.address), "positionRouter.setAdmin")
  }

  let fastPriceEvents;
  if(contractBase.fastPriceEvents){
    fastPriceEvents = await contractAt("FastPriceEvents", contractBase.fastPriceEvents)
  }else {
    fastPriceEvents = await deployContract("FastPriceEvents", [])
    writeTmpAddresses({fastPriceEvents: fastPriceEvents.address})
  }

  const {btc, eth, link, dai, usdc, usdt} = tokens
  const tokenArr = [btc, eth, link, dai, usdc, usdt]

  let secondaryPriceFeed;
  if(contractBase.secondaryPriceFeed){
    secondaryPriceFeed = await contractAt("FastPriceFeed", contractBase.secondaryPriceFeed)
  }else {
    secondaryPriceFeed = await deployContract("FastPriceFeed", [
      5 * 60, // _priceDuration
      60 * 60, // _maxPriceUpdateDelay
      1, // _minBlockInterval
      250, // _maxDeviationBasisPoints
      fastPriceEvents.address, // _fastPriceEvents
      deployer.address // _tokenManager
    ])
    writeTmpAddresses({secondaryPriceFeed: secondaryPriceFeed.address})

    await sendTxn(vaultPriceFeed.setSecondaryPriceFeed(secondaryPriceFeed.address), "vaultPriceFeed.setSecondaryPriceFeed")

    for (const token of tokenArr) {
      await sendTxn(vaultPriceFeed.setTokenConfig(
        token.address, // _token
        token.priceFeed, // _priceFeed
        token.priceDecimals, // _priceDecimals
        token.isStrictStable // _isStrictStable
      ), `vaultPriceFeed.setTokenConfig(${token.name}) ${token.address} ${token.priceFeed}`)
    }


    const fastPriceTokens = [
      btc,
      eth,//ETH
      link,//LINK
    ]
    await sendTxn(secondaryPriceFeed.initialize(1, signers, updaters), "secondaryPriceFeed.initialize")
    await sendTxn(secondaryPriceFeed.setTokens(fastPriceTokens.map(t => t.address), fastPriceTokens.map(t => t.fastPricePrecision)), "secondaryPriceFeed.setTokens")
    await sendTxn(secondaryPriceFeed.setVaultPriceFeed(vaultPriceFeed.address), "secondaryPriceFeed.setVaultPriceFeed")
    await sendTxn(secondaryPriceFeed.setMaxTimeDeviation(60 * 60), "secondaryPriceFeed.setMaxTimeDeviation")
    await sendTxn(secondaryPriceFeed.setSpreadBasisPointsIfInactive(50), "secondaryPriceFeed.setSpreadBasisPointsIfInactive")
    await sendTxn(secondaryPriceFeed.setSpreadBasisPointsIfChainError(500), "secondaryPriceFeed.setSpreadBasisPointsIfChainError")
    await sendTxn(secondaryPriceFeed.setMaxCumulativeDeltaDiffs(fastPriceTokens.map(t => t.address), fastPriceTokens.map(t => t.maxCumulativeDeltaDiff)), "secondaryPriceFeed.setMaxCumulativeDeltaDiffs")
    await sendTxn(secondaryPriceFeed.setPriceDataInterval(1 * 60), "secondaryPriceFeed.setPriceDataInterval")
    await sendTxn(positionRouter.setPositionKeeper(secondaryPriceFeed.address, true), "positionRouter.setPositionKeeper(secondaryPriceFeed)")
    await sendTxn(fastPriceEvents.setIsPriceFeed(secondaryPriceFeed.address, true), "fastPriceEvents.setIsPriceFeed")

    for (const token of tokenArr) {
      await sendTxn(vault.setTokenConfig(
        token.address, // _token
        token.decimals, // _tokenDecimals
        token.tokenWeight, // _tokenWeight
        token.minProfitBps, // _minProfitBps
        expandDecimals(token.maxUsdgAmount, 18), // _maxUsdgAmount
        token.isStable, // _isStable
        token.isShortable // _isShortable
      ), `vault.setTokenConfig(${token.name}) ${token.address}`)
    }
  }

  const positionManagerArgs = [vault.address, router.address, shortsTracker.address, nativeToken.address, depositFee, orderBook.address]

  let positionManager;
  if(contractBase.positionManager){
    positionManager = await contractAt("PositionManager", contractBase.positionManager,null,{
      libraries: {
        PositionUtils: positionUtils.address
      }
    })
  }else {
    positionManager = await deployContract("PositionManager", positionManagerArgs, "PositionManager", {
      libraries: {
        PositionUtils: positionUtils.address
      }
    })
    writeTmpAddresses({positionManager: positionManager.address})

    if ((await positionManager.referralStorage()).toLowerCase() != referralStorage.address.toLowerCase()) {
      await sendTxn(positionManager.setReferralStorage(referralStorage.address), "positionManager.setReferralStorage")
    }
    if (await positionManager.shouldValidateIncreaseOrder()) {
      await sendTxn(positionManager.setShouldValidateIncreaseOrder(false), "positionManager.setShouldValidateIncreaseOrder(false)")
    }

    for (let i = 0; i < orderKeepers.length; i++) {
      const orderKeeper = orderKeepers[i]
      if (!(await positionManager.isOrderKeeper(orderKeeper.address))) {
        await sendTxn(positionManager.setOrderKeeper(orderKeeper.address, true), "positionManager.setOrderKeeper(orderKeeper)")
      }
    }

    for (let i = 0; i < liquidators.length; i++) {
      const liquidator = liquidators[i]
      if (!(await positionManager.isLiquidator(liquidator.address))) {
        await sendTxn(positionManager.setLiquidator(liquidator.address, true), "positionManager.setLiquidator(liquidator)")
      }
    }

    if (!(await vault.isLiquidator(positionManager.address))) {
      await sendTxn(vault.setLiquidator(positionManager.address, true), "vault.setLiquidator(positionManager, true)")
    }

    if (!(await shortsTracker.isHandler(positionManager.address))) {
      await sendTxn(shortsTracker.setHandler(positionManager.address, true), "shortsTracker.setContractHandler(positionManager.address, true)")
    }
    if (!(await router.plugins(positionManager.address))) {
      await sendTxn(router.addPlugin(positionManager.address), "router.addPlugin(positionManager)")
    }

    if (!(await router.plugins(orderBook.address))) {
      await sendTxn(router.addPlugin(orderBook.address), "router.addPlugin(positionManager)")
    }

    for (let i = 0; i < partnerContracts.length; i++) {
      const partnerContract = partnerContracts[i]
      if (!(await positionManager.isPartner(partnerContract))) {
        await sendTxn(positionManager.setPartner(partnerContract, true), "positionManager.setPartner(partnerContract)")
      }
    }

    if ((await positionManager.gov()) != (await vault.gov())) {
      await sendTxn(positionManager.setGov(await vault.gov()), "positionManager.setGov")
    }
  }


  let orderExecutor;
  if(contractBase.orderExecutor){
    orderExecutor = await contractAt("OrderExecutor", contractBase.orderExecutor)
  }else {
    orderExecutor = await deployContract("OrderExecutor", [vault.address, orderBook.address])
    writeTmpAddresses({orderExecutor: orderExecutor.address})


    const tokenAddresses = tokenArr.map(t => t.address)
    const longSizes = tokenArr.map((token) => {
      if (!token.maxGlobalLongSize) {
        return bigNumberify(0)
      }

      return expandDecimals(token.maxGlobalLongSize, 30)
    })

    const shortSizes = tokenArr.map((token) => {
      if (!token.maxGlobalShortSize) {
        return bigNumberify(0)
      }

      return expandDecimals(token.maxGlobalShortSize, 30)
    })

    await sendTxn(positionRouter.setMaxGlobalSizes(tokenAddresses, longSizes, shortSizes), "positionRouter.setMaxGlobalSizes")
    await sendTxn(positionManager.setMaxGlobalSizes(tokenAddresses, longSizes, shortSizes), "positionManager.setMaxGlobalSizes")
  }

  let vaultReader;
  if(contractBase.vaultReader){
    vaultReader = await contractAt("VaultReader", contractBase.vaultReader)
  }else {
    vaultReader = await deployContract("VaultReader", [], "VaultReader")
    writeTmpAddresses({vaultReader: vaultReader.address})
  }

  let reader;
  if(contractBase.reader){
    reader = await contractAt("Reader", contractBase.reader)
  }else {
    reader = await deployContract("Reader", [], "Reader")
    writeTmpAddresses({reader: reader.address})

    await sendTxn(reader.setConfig(true), "Reader.setConfig")
  }

  let orderBookReader;
  if(contractBase.orderBookReader){
    orderBookReader = await contractAt("OrderBookReader", contractBase.orderBookReader)
  }else {
    orderBookReader = await deployContract("OrderBookReader", [])
    writeTmpAddresses({orderBookReader: orderBookReader.address})
  }


  let eddx;
  if(contractBase.eddx){
    eddx = await contractAt("EDDX", contractBase.eddx)
  }else {
    eddx = await deployContract("EDDX", []);
    writeTmpAddresses({eddx: eddx.address})
  }

  let esEddx;
  if(contractBase.esEddx){
    esEddx = await contractAt("EsEDDX", contractBase.esEddx)
  }else {
    esEddx = await deployContract("EsEDDX", []);
    writeTmpAddresses({esEddx: esEddx.address})
  }

  let bnEddx;
  if(contractBase.bnEddx){
    bnEddx = await contractAt("MintableBaseToken", contractBase.bnEddx)
  }else {
    bnEddx = await deployContract("MintableBaseToken", ["Bonus EDDX", "bnEDDX", 0]);
    writeTmpAddresses({bnEddx: bnEddx.address})

    await sendTxn(esEddx.setInPrivateTransferMode(true), "esEddx.setInPrivateTransferMode")
  }

  let stakedEddxTracker;
  if(contractBase.stakedEddxTracker){
    stakedEddxTracker = await contractAt("StakedEddxTracker", contractBase.stakedEddxTracker)
  }else {
    stakedEddxTracker = await deployContract("StakedEddxTracker", ["Staked EDDX", "sEDDX"])
    writeTmpAddresses({stakedEddxTracker: stakedEddxTracker.address})
  }

  let stakedEddxDistributor;
  if(contractBase.stakedEddxDistributor){
    stakedEddxDistributor = await contractAt("RewardDistributor", contractBase.stakedEddxDistributor)
  }else {
    stakedEddxDistributor = await deployContract("RewardDistributor", [esEddx.address, stakedEddxTracker.address])
    writeTmpAddresses({stakedEddxDistributor: stakedEddxDistributor.address})

    await sendTxn(stakedEddxTracker.initialize([eddx.address, esEddx.address], stakedEddxDistributor.address), "stakedEddxTracker.initialize")
    await sendTxn(stakedEddxDistributor.updateLastDistributionTime(), "stakedEddxDistributor.updateLastDistributionTime")
  }

  let bonusEddxTracker;
  if(contractBase.bonusEddxTracker){
    bonusEddxTracker = await contractAt("RewardTracker", contractBase.bonusEddxTracker)
  }else {
    bonusEddxTracker = await deployContract("RewardTracker", ["Staked + Bonus EDDX", "sbEDDX"])
    writeTmpAddresses({bonusEddxTracker: bonusEddxTracker.address})
  }

  let bonusEddxDistributor;
  if(contractBase.bonusEddxDistributor){
    bonusEddxDistributor = await contractAt("BonusDistributor", contractBase.bonusEddxDistributor)
  }else {
    bonusEddxDistributor = await deployContract("BonusDistributor", [bnEddx.address, bonusEddxTracker.address])
    writeTmpAddresses({bonusEddxDistributor: bonusEddxDistributor.address})

    await sendTxn(bonusEddxTracker.initialize([stakedEddxTracker.address], bonusEddxDistributor.address), "bonusEddxTracker.initialize")
    await sendTxn(bonusEddxDistributor.updateLastDistributionTime(), "bonusEddxDistributor.updateLastDistributionTime")
  }

  let feeEddxTracker;
  if(contractBase.feeEddxTracker){
    feeEddxTracker = await contractAt("RewardTracker", contractBase.feeEddxTracker)
  }else {
    feeEddxTracker = await deployContract("RewardTracker", ["Staked + Bonus + Fee EDDX", "sbfEDDX"])
    writeTmpAddresses({feeEddxTracker: feeEddxTracker.address})
  }

  let feeEddxDistributor;
  if(contractBase.feeEddxDistributor){
    feeEddxDistributor = await contractAt("RewardDistributor", contractBase.feeEddxDistributor)
  }else {
    feeEddxDistributor = await deployContract("RewardDistributor", [nativeToken.address, feeEddxTracker.address])
    writeTmpAddresses({feeEddxDistributor: feeEddxDistributor.address})

    await sendTxn(feeEddxTracker.initialize([bonusEddxTracker.address, bnEddx.address], feeEddxDistributor.address), "feeEddxTracker.initialize")
    await sendTxn(feeEddxDistributor.updateLastDistributionTime(), "feeEddxDistributor.updateLastDistributionTime")
  }

  let feeElpTracker;
  if(contractBase.feeElpTracker){
    feeElpTracker = await contractAt("RewardTracker", contractBase.feeElpTracker)
  }else {
    feeElpTracker = await deployContract("RewardTracker", ["Fee ELP", "fELP"])
    writeTmpAddresses({feeElpTracker: feeElpTracker.address})
  }

  let feeElpDistributor;
  if(contractBase.feeElpDistributor){
    feeElpDistributor = await contractAt("RewardDistributor", contractBase.feeElpDistributor)
  }else {
    feeElpDistributor = await deployContract("RewardDistributor", [nativeToken.address, feeElpTracker.address])
    writeTmpAddresses({feeElpDistributor: feeElpDistributor.address})

    await sendTxn(feeElpTracker.initialize([elp.address], feeElpDistributor.address), "feeElpTracker.initialize")
    await sendTxn(feeElpDistributor.updateLastDistributionTime(), "feeElpDistributor.updateLastDistributionTime")
  }

  let stakedElpTracker;
  if(contractBase.stakedElpTracker){
    stakedElpTracker = await contractAt("RewardTracker", contractBase.stakedElpTracker)
  }else {
    stakedElpTracker = await deployContract("RewardTracker", ["Fee + Staked ELP", "fsELP"])
    writeTmpAddresses({stakedElpTracker: stakedElpTracker.address})
  }

  let stakedElpDistributor;
  if(contractBase.stakedElpDistributor){
    stakedElpDistributor = await contractAt("RewardDistributor", contractBase.stakedElpDistributor)
  }else {
    stakedElpDistributor = await deployContract("RewardDistributor", [esEddx.address, stakedElpTracker.address])
    writeTmpAddresses({stakedElpDistributor: stakedElpDistributor.address})

    await sendTxn(stakedElpTracker.initialize([feeElpTracker.address], stakedElpDistributor.address), "stakedElpTracker.initialize")
    await sendTxn(stakedElpDistributor.updateLastDistributionTime(), "stakedElpDistributor.updateLastDistributionTime")

    await sendTxn(stakedEddxTracker.setInPrivateTransferMode(true), "stakedEddxTracker.setInPrivateTransferMode")
    await sendTxn(stakedEddxTracker.setInPrivateStakingMode(true), "stakedEddxTracker.setInPrivateStakingMode")
    await sendTxn(bonusEddxTracker.setInPrivateTransferMode(true), "bonusEddxTracker.setInPrivateTransferMode")
    await sendTxn(bonusEddxTracker.setInPrivateStakingMode(true), "bonusEddxTracker.setInPrivateStakingMode")
    await sendTxn(bonusEddxTracker.setInPrivateClaimingMode(true), "bonusEddxTracker.setInPrivateClaimingMode")
    await sendTxn(feeEddxTracker.setInPrivateTransferMode(true), "feeEddxTracker.setInPrivateTransferMode")
    await sendTxn(feeEddxTracker.setInPrivateStakingMode(true), "feeEddxTracker.setInPrivateStakingMode")

    await sendTxn(feeElpTracker.setInPrivateTransferMode(true), "feeElpTracker.setInPrivateTransferMode")
    await sendTxn(feeElpTracker.setInPrivateStakingMode(true), "feeElpTracker.setInPrivateStakingMode")
    await sendTxn(stakedElpTracker.setInPrivateTransferMode(true), "stakedElpTracker.setInPrivateTransferMode")
    await sendTxn(stakedElpTracker.setInPrivateStakingMode(true), "stakedElpTracker.setInPrivateStakingMode")
  }

  let eddxVester;
  if(contractBase.eddxVester){
    eddxVester = await contractAt("VesterV2", contractBase.eddxVester)
  }else {
    eddxVester = await deployContract("VesterV2", [
      "Vested EDDX", // _name
      "vEDDX", // _symbol
      esEddx.address, // _esToken
      feeEddxTracker.address, // _pairToken
      eddx.address, // _claimableToken
      stakedEddxTracker.address, // _rewardTracker
    ])
    writeTmpAddresses({eddxVester: eddxVester.address})
  }

  let elpVester;
  if(contractBase.elpVester){
    elpVester = await contractAt("VesterV2", contractBase.elpVester)
  }else {
    elpVester = await deployContract("VesterV2", [
      "Vested ELP", // _name
      "vELP", // _symbol
      esEddx.address, // _esToken
      stakedElpTracker.address, // _pairToken
      eddx.address, // _claimableToken
      stakedElpTracker.address, // _rewardTracker
    ])
    writeTmpAddresses({elpVester: elpVester.address})
  }

  let rewardRouter;
  if(contractBase.rewardRouter){
    rewardRouter = await contractAt("RewardRouterV2", contractBase.rewardRouter)
  }else {
    rewardRouter = await deployContract("RewardRouterV2", [])
    writeTmpAddresses({rewardRouter: rewardRouter.address})


    await sendTxn(rewardRouter.initialize(
      nativeToken.address,
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
    ), "rewardRouter.initialize")

    await sendTxn(elpManager.setHandler(rewardRouter.address, true), "elpManager.setHandler(rewardRouter)")
    // allow rewardRouter to stake in stakedEddxTracker
    await sendTxn(stakedEddxTracker.setHandler(rewardRouter.address, true), "stakedEddxTracker.setHandler(rewardRouter)")
    // allow bonusEddxTracker to stake stakedEddxTracker
    await sendTxn(stakedEddxTracker.setHandler(bonusEddxTracker.address, true), "stakedEddxTracker.setHandler(bonusEddxTracker)")
    // allow rewardRouter to stake in bonusEddxTracker
    await sendTxn(bonusEddxTracker.setHandler(rewardRouter.address, true), "bonusEddxTracker.setHandler(rewardRouter)")
    // allow bonusEddxTracker to stake feeEddxTracker
    await sendTxn(bonusEddxTracker.setHandler(feeEddxTracker.address, true), "bonusEddxTracker.setHandler(feeEddxTracker)")
    await sendTxn(bonusEddxDistributor.setBonusMultiplier(10000), "bonusEddxDistributor.setBonusMultiplier")
    // allow rewardRouter to stake in feeEddxTracker
    await sendTxn(feeEddxTracker.setHandler(rewardRouter.address, true), "feeEddxTracker.setHandler(rewardRouter)")
    // allow stakedEddxTracker to stake esEddx
    await sendTxn(esEddx.setHandler(stakedEddxTracker.address, true), "esEddx.setHandler(stakedEddxTracker)")
    // allow feeEddxTracker to stake bnEddx
    await sendTxn(bnEddx.setHandler(feeEddxTracker.address, true), "bnEddx.setHandler(feeEddxTracker")
    // allow rewardRouter to burn bnEddx
    await sendTxn(bnEddx.setMinter(rewardRouter.address, true), "bnEddx.setMinter(rewardRouter")
    // allow stakedElpTracker to stake feeElpTracker
    await sendTxn(feeElpTracker.setHandler(stakedElpTracker.address, true), "feeElpTracker.setHandler(stakedElpTracker)")
    // allow feeElpTracker to stake elp
    await sendTxn(elp.setHandler(feeElpTracker.address, true), "elp.setHandler(feeElpTracker)")
    // allow rewardRouter to stake in feeElpTracker
    await sendTxn(feeElpTracker.setHandler(rewardRouter.address, true), "feeElpTracker.setHandler(rewardRouter)")
    // allow rewardRouter to stake in stakedElpTracker
    await sendTxn(stakedElpTracker.setHandler(rewardRouter.address, true), "stakedElpTracker.setHandler(rewardRouter)")

    await sendTxn(esEddx.setHandler(rewardRouter.address, true), "esEddx.setHandler(rewardRouter)")
    await sendTxn(esEddx.setHandler(stakedEddxDistributor.address, true), "esEddx.setHandler(stakedEddxDistributor)")
    await sendTxn(esEddx.setHandler(stakedElpDistributor.address, true), "esEddx.setHandler(stakedElpDistributor)")
    await sendTxn(esEddx.setHandler(stakedElpTracker.address, true), "esEddx.setHandler(stakedElpTracker)")
    await sendTxn(esEddx.setHandler(eddxVester.address, true), "esEddx.setHandler(eddxVester)")
    await sendTxn(esEddx.setHandler(elpVester.address, true), "esEddx.setHandler(elpVester)")

    await sendTxn(esEddx.setMinter(eddxVester.address, true), "esEddx.setMinter(eddxVester)")
    await sendTxn(esEddx.setMinter(elpVester.address, true), "esEddx.setMinter(elpVester)")

    await sendTxn(eddxVester.setHandler(rewardRouter.address, true), "eddxVester.setHandler(rewardRouter)")
    await sendTxn(elpVester.setHandler(rewardRouter.address, true), "elpVester.setHandler(rewardRouter)")

    await sendTxn(feeEddxTracker.setHandler(eddxVester.address, true), "feeEddxTracker.setHandler(eddxVester)")
    await sendTxn(stakedElpTracker.setHandler(elpVester.address, true), "stakedElpTracker.setHandler(elpVester)")
  }

  let glpRewardRouter;
  if (contractBase.glpRewardRouter){
    glpRewardRouter = await contractAt("RewardRouterV2", contractBase.glpRewardRouter)
  } else {
    glpRewardRouter = await deployContract("RewardRouterV2", [])
    writeTmpAddresses({glpRewardRouter: glpRewardRouter.address})

    await sendTxn(glpRewardRouter.initialize(
      nativeToken.address, // _weth
      AddressZero, // _eddx
      AddressZero, // _esEddx
      AddressZero, // _bnEddx
      elp.address, // _elp
      AddressZero, // _stakedEddxTracker
      AddressZero, // _bonusEddxTracker
      AddressZero, // _feeEddxTracker
      feeElpTracker.address, // _feeElpTracker
      stakedElpTracker.address, // _stakedElpTracker
      elpManager.address, // _elpManager
      AddressZero, // _eddxVester
      AddressZero // elpVester
    ), "rewardRouter.initialize")

    await sendTxn(elpManager.setHandler(glpRewardRouter.address, true), "elpManager.setHandler(glpRewardRouter)")
    // allow rewardRouter to stake in feeElpTracker
    await sendTxn(feeElpTracker.setHandler(glpRewardRouter.address, true), "feeElpTracker.setHandler(glpRewardRouter)")
    // allow rewardRouter to stake in stakedElpTracker
    await sendTxn(stakedElpTracker.setHandler(glpRewardRouter.address, true), "stakedElpTracker.setHandler(glpRewardRouter)")
  }

  let rewardReader;
  if (contractBase.rewardReader){
    rewardReader = await contractAt("RewardReader", contractBase.rewardReader)
  } else {
    rewardReader = await deployContract("RewardReader", [], "RewardReader")
    writeTmpAddresses({rewardReader: rewardReader.address})


    // mint esEddx for distributors
    await sendTxn(esEddx.setMinter(deployer.address, true), "esEddx.setMinter(wallet)")

    await sendTxn(esEddx.mint(stakedEddxDistributor.address, expandDecimals(50000 * 12, 18)), "esEddx.mint(stakedEddxDistributor") // ~50,000 EDDX per month
    await sendTxn(stakedEddxDistributor.setTokensPerInterval("20667989410000000"), "stakedEddxDistributor.setTokensPerInterval") // 0.02066798941 esEddx per second

    await sendTxn(esEddx.mint(stakedElpDistributor.address, expandDecimals(50000 * 12, 18)), "esEddx.mint(stakedEddxDistributor") // ~50,000 EDDX per month
    await sendTxn(stakedElpDistributor.setTokensPerInterval("20667989410000000"), "stakedEddxDistributor.setTokensPerInterval") // 0.02066798941 esEddx per second


    // mint bnEddx for distributor
    await sendTxn(bnEddx.setMinter(deployer.address, true), "bnEddx.setMinter")
    await sendTxn(bnEddx.mint(bonusEddxDistributor.address, expandDecimals(15 * 1000 * 1000, 18)), "bnEddx.mint(bonusEddxDistributor)")
  }

  // todo 为feeEddxDistributor  feeElpDistributor 添加奖励
  // todo 思路是进行手续费的分成，keeper 1%，feeEddx和feeElp按照3:7分剩余的99%
  // const wethBalance = await weth.balanceOf(deployer.address);
  // console.log(wethBalance.toString())
  // await weth.transfer(feeEddxDistributor.address,expandDecimals(1, 18))
  // await weth.transfer(feeElpDistributor.address,expandDecimals(1, 18))
  // await sendTxn(feeEddxDistributor.setTokensPerInterval("344466490166"), "feeEddxDistributor.setTokensPerInterval") // 0.02066798941 eth per second
  // await sendTxn(feeElpDistributor.setTokensPerInterval("344466490166"), "feeElpDistributor.setTokensPerInterval") // 0.02066798941 eth per second

  //todo eddx 暂时不确定这里的eddx奖励从哪里来
  // await eddx.transfer(eddxVester.address,expandDecimals(10000,18))
  // await eddx.transfer(elpVester.address,expandDecimals(10000,18))

  let batchSender;
  if (contractBase.batchSender){
    batchSender = await contractAt("BatchSender", contractBase.batchSender)
  }else {
    batchSender = await deployContract("BatchSender", [])
    writeTmpAddresses({batchSender: batchSender.address})


    // todo
    await sendTxn(eddx.setMinter(deployer.address, true), "eddx.setMinter(deployer.address, true)");
    await sendTxn(eddx.mint(deployer.address, expandDecimals(27000000, 18)), "eddx.mint(deployer.address, expandDecimals(27000000, 18))");
  }

  let timeLock;
  if (contractBase.timeLock){
    timeLock = await contractAt("Timelock", contractBase.timeLock)
  }else {
    timeLock = await deployContract("Timelock", [
      deployer.address, // admin
      buffer, // buffer
      deployer.address, // tokenManager
      deployer.address, // mintReceiver
      elpManager.address, // elpManager
      rewardRouter.address, // rewardRouter
      maxTokenSupply, // maxTokenSupply
      10, // marginFeeBasisPoints 0.1%
      500 // maxMarginFeeBasisPoints 5%
    ], "Timelock")
    writeTmpAddresses({timeLock: timeLock.address})

    await sendTxn(timeLock.setShouldToggleIsLeverageEnabled(true), "deployedTimelock.setShouldToggleIsLeverageEnabled(true)")
    await sendTxn(timeLock.setContractHandler(positionRouter.address, true), "deployedTimelock.setContractHandler(positionRouter)")
    await sendTxn(timeLock.setContractHandler(positionManager.address, true), "deployedTimelock.setContractHandler(positionManager)")
    await sendTxn(vault.setGov(timeLock.address), "set vault gov to timelock");

    // todo set eddx gov to timelocak
    // await sendTxn(eddx.setGov(timeLock.address), "eddx.setGov(timeLock.address)");
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
