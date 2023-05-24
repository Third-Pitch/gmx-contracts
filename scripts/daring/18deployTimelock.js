const { deployContract, contractAt, sendTxn, getFrameSigner } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');

async function getValues() {
  const vault = await contractAt("Vault", "0xfD22f2b0975Ff9219a635cF84F3Fd154AB78af9B")
  const tokenManager = { address: "0xcb5A899FfcB0049BDeF4205694DCCCE29cbFf21F" }
  const glpManager = { address: "0xE76eEc5A8561Bf5fc01c5e4946F66aE5e2f07CF5" }
  const rewardRouter = { address: "0xC125A16E5BDCEB2E4E5950df1490c891D7bE2Cd1" }

  const positionRouter = { address: "0xECA4B3f2aF83367B047bbf2DeCC3BA39630CE1FC" }
  const positionManager = { address: "0xbA641fB4B8aE011d62619B61230f7c1c17515C14" }
  const gmx = { address: "0x9fD329310b43d00AAf050518200732AC45f34dC5" }

  return { vault, tokenManager, glpManager, rewardRouter, positionRouter, positionManager, gmx }
}

async function main() {
  // const signer = await getFrameSigner()

  const admin = "0xcb5A899FfcB0049BDeF4205694DCCCE29cbFf21F"
  const buffer = 24 * 60 * 60
  const maxTokenSupply = expandDecimals("500000000", 18)

  const { vault, tokenManager, glpManager, rewardRouter, positionRouter, positionManager, gmx } = await getValues()
  const mintReceiver = tokenManager

  const timelock = await deployContract("Timelock", [
    admin, // admin
    buffer, // buffer
    tokenManager.address, // tokenManager
    mintReceiver.address, // mintReceiver
    glpManager.address, // glpManager
    rewardRouter.address, // rewardRouter
    maxTokenSupply, // maxTokenSupply
    10, // marginFeeBasisPoints 0.1%
    500 // maxMarginFeeBasisPoints 5%
  ], "Timelock")

  const deployedTimelock = await contractAt("Timelock", timelock.address)

  await sendTxn(deployedTimelock.setShouldToggleIsLeverageEnabled(true), "deployedTimelock.setShouldToggleIsLeverageEnabled(true)")
  await sendTxn(deployedTimelock.setContractHandler(positionRouter.address, true), "deployedTimelock.setContractHandler(positionRouter)")
  await sendTxn(deployedTimelock.setContractHandler(positionManager.address, true), "deployedTimelock.setContractHandler(positionManager)")

  await sendTxn(vault.setGov(timelock.address),"set vault gov to timelock");


  // // update gov of vault
  // const vaultGov = await contractAt("Timelock", await vault.gov(), signer)

  // await sendTxn(vaultGov.signalSetGov(vault.address, deployedTimelock.address), "vaultGov.signalSetGov")
  // await sendTxn(deployedTimelock.signalSetGov(vault.address, vaultGov.address), "deployedTimelock.signalSetGov(vault)")

  // const handlers = [
  //   "0x82429089e7c86B7047b793A9E7E7311C93d2b7a6", // coinflipcanada
  //   "0xD7941C4Ca57a511F21853Bbc7FBF8149d5eCb398", // G
  //   "0xfb481D70f8d987c1AE3ADc90B7046e39eb6Ad64B", // kr
  //   "0x99Aa3D1b3259039E8cB4f0B33d0Cfd736e1Bf49E", // quat
  //   "0x6091646D0354b03DD1e9697D33A7341d8C93a6F5" // xhiroz
  // ]
  //
  // for (let i = 0; i < handlers.length; i++) {
  //   const handler = handlers[i]
  //   await sendTxn(deployedTimelock.setContractHandler(handler, true), `deployedTimelock.setContractHandler(${handler})`)
  // }

  // const keepers = [
  //   "0x5F799f365Fa8A2B60ac0429C48B153cA5a6f0Cf8" // X
  // ]
  //
  // for (let i = 0; i < keepers.length; i++) {
  //   const keeper = keepers[i]
  //   await sendTxn(deployedTimelock.setKeeper(keeper, true), `deployedTimelock.setKeeper(${keeper})`)
  // }
  //
  // await sendTxn(deployedTimelock.signalApprove(gmx.address, admin, "1000000000000000000"), "deployedTimelock.signalApprove")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
