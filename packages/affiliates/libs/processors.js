const {BalanceHistories,Attributions} = require('./models')
// composes the models into a processor which takes in
// events: balance update (insertBalance) and attribution (insertAttribution)
// once events are processed gets total shares as json object
module.exports = (config)=>{
  const histories = BalanceHistories()
  const attributions = Attributions()

  function insertBalance(address,balance,blockNumber){
    histories.insert(address,{blockNumber,balance})
  }

  function insertAttribution(affiliateAddress,userAddress,blockNumber){
    const result = histories.lookup(userAddress,blockNumber)
    if(!result) return
    attributions.add(affiliateAddress,result.balance)
  }

  function shares(){
    return attributions.listPercents()
  }

  return {
    insertAttribution,
    insertBalance,
    shares,
  }
}
