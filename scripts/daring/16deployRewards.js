const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
async function main() {
  const { nativeToken } = tokens
  const deployer = {address: "0xcb5A899FfcB0049BDeF4205694DCCCE29cbFf21F"}
  const weth = await contractAt("WETH",nativeToken.address)
  const gmx =  await contractAt("GMX", "0x9fD329310b43d00AAf050518200732AC45f34dC5");
  const esGmx = await contractAt("EsGMX", "0x5bb20b6583C4D9F591fa2816bd1F2fCc84646f10");
  const bnGmx = await contractAt("MintableBaseToken", "0x190f255C2f5E1bA5a070956f0B20e93351841E41");

  const stakedGmxDistributor = await contractAt("RewardDistributor", "0xA0dAb4a62000Dd9E7C2E4bE80b236EB908A28f05") //esGmx
  const bonusGmxDistributor = await contractAt("BonusDistributor", "0x37154Df943287868d91604D5E43522fF352280c7")//bnGmx
  const feeGmxDistributor = await contractAt("RewardDistributor", "0x2E7b88f2A77976e7D143D19200D14d863Eae67E6") //weth
  const feeGlpDistributor = await contractAt("RewardDistributor", "0x3851A4d4C6cDdF8a2ED03d31b49A7578E5186f96") //weth
  const stakedGlpDistributor = await contractAt("RewardDistributor", "0x7dA0DaEfbE12AA190f2779f86A309823B8Fa78Fe") //esGmx


  // mint esGmx for distributors
  await sendTxn(esGmx.setMinter(deployer.address, true), "esGmx.setMinter(wallet)")
  await sendTxn(esGmx.mint(stakedGmxDistributor.address, expandDecimals(50000 * 12, 18)), "esGmx.mint(stakedGmxDistributor") // ~50,000 GMX per month
  await sendTxn(stakedGmxDistributor.setTokensPerInterval("20667989410000000"), "stakedGmxDistributor.setTokensPerInterval") // 0.02066798941 esGmx per second

  await sendTxn(esGmx.mint(stakedGlpDistributor.address, expandDecimals(50000 * 12, 18)), "esGmx.mint(stakedGmxDistributor") // ~50,000 GMX per month
  await sendTxn(stakedGlpDistributor.setTokensPerInterval("20667989410000000"), "stakedGmxDistributor.setTokensPerInterval") // 0.02066798941 esGmx per second


  // mint bnGmx for distributor
  await sendTxn(bnGmx.setMinter(deployer.address, true), "bnGmx.setMinter")
  await sendTxn(bnGmx.mint(bonusGmxDistributor.address, expandDecimals(15 * 1000 * 1000, 18)), "bnGmx.mint(bonusGmxDistributor)")

  // todo 为feeGmxDistributor  feeGlpDistributor 添加奖励
  const wethBalance = await weth.balanceOf(deployer.address);
  console.log(wethBalance.toString())
  await weth.transfer(feeGmxDistributor.address,expandDecimals(1, 18))
  await weth.transfer(feeGlpDistributor.address,expandDecimals(1, 18))
  await sendTxn(feeGmxDistributor.setTokensPerInterval("344466490166"), "feeGmxDistributor.setTokensPerInterval") // 0.02066798941 eth per second
  await sendTxn(feeGlpDistributor.setTokensPerInterval("344466490166"), "feeGlpDistributor.setTokensPerInterval") // 0.02066798941 eth per second
  //todo gmx

  const gmxVester = await contractAt("Vester", "0xC5E932347B1524ca8F3359C93daf6422040FDbf5")
  const glpVester = await contractAt("Vester", "0xE221ac2C76f7c3fC1025C8973510cB9E30955cc5")
  await gmx.transfer(gmxVester.address,expandDecimals(10000,18))
  await gmx.transfer(glpVester.address,expandDecimals(10000,18))

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
