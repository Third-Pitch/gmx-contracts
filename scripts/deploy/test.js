
const BN = require('bn.js')


async function main() {

  let a = new BN("20797725362500199283408000000").add(
    new BN("20797725362500199283408000000").add(new BN("28511003265062047616200000000000000"))
  ).add(new BN("332812964708138335205000000000"))
  console.log(a.toString())
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
