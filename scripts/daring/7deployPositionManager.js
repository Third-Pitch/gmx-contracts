const { getFrameSigner, deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { toUsd } = require("../../test/shared/units")
const { errors } = require("../../test/core/Vault/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];

const depositFee = 30 // 0.3%
const deployer = {address: "0xcb5A899FfcB0049BDeF4205694DCCCE29cbFf21F"}
const orderKeepers = [
  { address: deployer.address }
]
const liquidators = [
  { address: deployer.address }
]

const partnerContracts = [deployer.address]
async function main() {


  const { nativeToken } = tokens
  const vault = await contractAt("Vault", "0xfD22f2b0975Ff9219a635cF84F3Fd154AB78af9B")
  const router = await contractAt("Router", "0x9dC1fE10842B517383Ed61cF35cC8553b0C4a3B2")
  const shortsTracker = await contractAt("ShortsTracker", "0x6305f6430bCabd340C5eE655EDf7d9bc6074Ae59")
  const orderBook = await contractAt("OrderBook", "0x5d0F1fE3613736fD0e4052534b8e089F04B8f2C1")
  const referralStorage = await contractAt("ReferralStorage", "0x71F6BFDF601d60862e805b4d6B7B0139839A8585")
  const positionUtils = await contractAt("PositionUtils", "0xB5C7f79E1eB48EE470831ED8582C1883d42a8cAB")
  const positionManagerArgs = [vault.address, router.address, shortsTracker.address, nativeToken.address, depositFee, orderBook.address]
  const positionManager = await deployContract("PositionManager", positionManagerArgs,"PositionManager",{
    libraries: {
      PositionUtils: positionUtils.address
    }
  })

  // positionManager only reads from referralStorage so it does not need to be set as a handler of referralStorage
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

  console.log("done.")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
