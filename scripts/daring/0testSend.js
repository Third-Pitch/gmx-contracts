const { deployContract, contractAt, sendTxn, sendEther} = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
async function main() {
  const { nativeToken,btc,link,dai,usdt,usdc } = tokens
  const weth = await contractAt("WETH",nativeToken.address)
  const btc1 = await contractAt("WETH",btc.address)
  const link1 = await contractAt("WETH",link.address)
  const usdc1 = await contractAt("WETH",usdc.address)
  const dai1 = await contractAt("WETH",dai.address)
  const usdt1 = await contractAt("WETH",usdt.address)
  const toAddress = "0x4777DD5b7bCAA65fE41CEed374B18913E34e9660"

  await weth.transfer(toAddress,expandDecimals(1, 18))
  await btc1.transfer(toAddress,expandDecimals(10000, 18))
  await link1.transfer(toAddress,expandDecimals(10000, 18))
  await usdc1.transfer(toAddress,expandDecimals(10000, 18))
  await dai1.transfer(toAddress,expandDecimals(10000, 18))
  await usdt1.transfer(toAddress,expandDecimals(10000, 18))
  // let tx = await sendEther(toAddress,expandDecimals(1, 18))
  // console.log(tx)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
