const {SharedAttributions, Balances} = require('./models')
const assert = require("assert")
// composes the models into a processor which takes in
// events: balance update (insertBalance) and attribution (insertAttribution)
// once events are processed gets total shares as json object
function Processor(config){
  const balances = Balances()
  const attributions = SharedAttributions()

  function mintEvent(){
  }
  function depositTo(){
  }
  function deposit(){
  }
  function transferPositionPassedRequest(){
  }
  function snapshot(){
  }
  function addBalanceByDelta(address,balance,blockNumber){
  }

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

function EmpBalances(handlers={},{collateral,tokens}={}){
  collateral = collateral || Balances()
  tokens = tokens || Balances()

  handlers = {
    RequestTransferPosition(oldSponsor){
      // nothing
    },
    RequestTransferPositionExecuted(oldSponsor, newSponsor){
      // console.log('transfer',oldSponsor,newSponsor)
      const collateralBalance = collateral.get(oldSponsor)
      collateral.set(oldSponsor,'0')
      collateral.set(newSponsor,collateralBalance.toString())

      const tokenBalance = tokens.get(oldSponsor)
      tokens.set(oldSponsor,'0')
      tokens.set(newSponsor,tokenBalance.toString())
    },
    RequestTransferPositionCanceled(oldSponsor){
      // nothing
    },
    Deposit(sponsor, collateralAmount){
      // console.log('deposit',sponsor,collateralAmount.toString())
      collateral.add(sponsor,collateralAmount.toString())
    },
    Withdrawal(sponsor, collateralAmount){
      // console.log('withdrawal',sponsor,collateralAmount.toString())
      collateral.sub(sponsor,collateralAmount.toString())
    },
    RequestWithdrawal(sponsor, collateralAmount){
      // nothing
    },
    RequestWithdrawalExecuted(sponsor, collateralAmount){
      // console.log('request withdraw executed',sponsor,collateralAmount.toString())
      collateral.sub(sponsor,collateralAmount.toString())
    },
    RequestWithdrawalCanceled(sponsor, collateralAmount){
      // nothing
    },
    PositionCreated(sponsor, collateralAmount, tokenAmount){
      // console.log('position created',sponsor,collateralAmount.toString(),tokenAmount.toString())
      collateral.add(sponsor,collateralAmount.toString())
      tokens.add(sponsor,tokenAmount.toString())
    },
    NewSponsor(sponsor){
      // nothing
    },
    EndedSponsorPosition(sponsor){
      // nothing
    },
    Redeem(sponsor, collateralAmount, tokenAmount){
      // console.log('redeem',sponsor,collateralAmount.toString(),tokenAmount.toString())
      collateral.sub(sponsor,collateralAmount.toString())
      tokens.sub(sponsor,tokenAmount).toString()
    },
    ContractExpired(caller){
      // nothing
    },
    SettleExpiredPosition( caller, collateralReturned, tokensBurned){
      collateral.sub(sponsor,collateralReturned.toString())
      tokens.sub(sponsor,tokensBurned.toString())
    },
    EmergencyShutdown(caller, originalExpirationTimestamp, shutdownTimestamp){
      // nothing
    },
    // override defaults
    ...handlers
  }


  function handleEvent({name,args=[]}){
    assert(handlers[name],'No handler for event: ' + name)
    return handlers[name](...args)
  }

  function getCollateral(){
    return collateral
  }
  function getTokens(){
    return tokens
  }
  return {
    handleEvent,
    getCollateral,
    getTokens,
  }
}


module.exports = {
  EmpBalances
}
