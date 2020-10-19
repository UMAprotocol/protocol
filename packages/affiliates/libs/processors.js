const {Balances,History, SharedAttributions} = require('./models')
const assert = require("assert")

// keeps snapshots of all attributions to affiliates keyed by user
function AttributionHistory(){
  // stores complete balances for all events
  const attributions = SharedAttributions()
  // stores snapshots we can lookup by block
  const history = History()
  let lastBlockNumber

  // takes a snapshot of balances if the next event falls on a new block
  function handleEvent(blockNumber,args=[]){
    assert(blockNumber,'requires blockNumber')
    if(lastBlockNumber == null){
      lastBlockNumber = blockNumber
      history.insert({
        blockNumber,
        attributions:attributions.snapshot(),
      })
    }else if(lastBlockNumber < blockNumber){
      history.insert({
        blockNumber,
        attributions:attributions.snapshot(),
      })
      lastBlockNumber = blockNumber
    }
    attributions.attribute(...args)
  }

  return {
    attributions,
    history,
    handleEvent,
  }
}

function EmpBalancesHistory(){
  // stores complete balances for all events
  const balances = EmpBalances()
  // stores snapshots we can lookup by block
  const history = History()
  let lastBlockNumber
  const blocks = []

  // takes a snapshot of balances if the next event falls on a new block
  function handleEvent(blockNumber,event){
    assert(blockNumber,'requires blockNumber')
    if(lastBlockNumber == null){
      lastBlockNumber = blockNumber
      blocks.push(blockNumber)
      history.insert({
        blockNumber,
        tokens:balances.tokens.snapshot(),
        collateral:balances.collateral.snapshot(),
      })
    }else if(lastBlockNumber < blockNumber){
      history.insert({
        blockNumber,
        tokens:balances.tokens.snapshot(),
        collateral:balances.collateral.snapshot(),
      })
      blocks.push(blockNumber)
      lastBlockNumber = blockNumber
    }
    balances.handleEvent(event)
  }

  return {
    balances,
    history,
    handleEvent,
    blocks,
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
      collateral.add(sponsor,collateralAmount.toString())
    },
    Withdrawal(sponsor, collateralAmount){
      collateral.sub(sponsor,collateralAmount.toString())
    },
    RequestWithdrawal(sponsor, collateralAmount){
      // nothing
    },
    RequestWithdrawalExecuted(sponsor, collateralAmount){
      collateral.sub(sponsor,collateralAmount.toString())
    },
    RequestWithdrawalCanceled(sponsor, collateralAmount){
      // nothing
    },
    PositionCreated(sponsor, collateralAmount, tokenAmount){
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
    collateral,
    tokens
  }
}


module.exports = {
  EmpBalances,
  EmpBalancesHistory,
  AttributionHistory,
}
