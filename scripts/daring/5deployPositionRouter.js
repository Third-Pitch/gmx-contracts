const { getFrameSigner, deployContract, contractAt , sendTxn, readTmpAddresses, writeTmpAddresses } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { toUsd } = require("../../test/shared/units")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];

async function main() {
  const depositFee = "30" // 0.3%
  const minExecutionFee = "100000000000000" // 0.0001 ETH
  const positionUtils = await deployContract("PositionUtils", [])
  const { nativeToken } = tokens
  const vault = await contractAt("Vault", "0xfD22f2b0975Ff9219a635cF84F3Fd154AB78af9B")
  const router = await contractAt("Router", "0x9dC1fE10842B517383Ed61cF35cC8553b0C4a3B2")
  const shortsTracker = await contractAt("ShortsTracker", "0x6305f6430bCabd340C5eE655EDf7d9bc6074Ae59")

  const positionRouterArgs = [vault.address, router.address, nativeToken.address, shortsTracker.address, depositFee, minExecutionFee]
  const positionRouter = await deployContract("PositionRouter", positionRouterArgs, "PositionRouter", {
      libraries: {
        PositionUtils: positionUtils.address
      }
  })
  const referralStorage = await contractAt("ReferralStorage", "0x71F6BFDF601d60862e805b4d6B7B0139839A8585")
  await sendTxn(positionRouter.setReferralStorage(referralStorage.address), "positionRouter.setReferralStorage")
  await sendTxn(referralStorage.setHandler(positionRouter.address, true),"ReferralStorage setHandler positionRouter");
  await sendTxn(router.addPlugin(positionRouter.address), "router.addPlugin")

  await sendTxn(positionRouter.setDelayValues(0, 180, 30 * 60), "positionRouter.setDelayValues")

  if (!(await shortsTracker.isHandler(positionRouter.address))) {
    await sendTxn(shortsTracker.setHandler(positionRouter.address, true), "shortsTracker.setContractHandler(positionRouter.address, true)")
  }
  await sendTxn(positionRouter.setGov(await vault.gov()), "positionRouter.setGov")
  const deployer = {address: "0xcb5A899FfcB0049BDeF4205694DCCCE29cbFf21F"}
  await sendTxn(positionRouter.setAdmin(deployer.address), "positionRouter.setAdmin")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
