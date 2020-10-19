const test = require('tape')
const lodash = require("lodash");
const {History,BalanceHistories,Attributions, Balances,SharedAttributions} = require('../libs/models')

test('SharedAttributions',t=>{
  let attributions
  t.test('init',t=>{
    attributions = SharedAttributions()
    t.ok(attributions)
    t.end()
  })
  t.test('create',t=>{
    const result = attributions.create('test')
    t.ok(result)
    t.end()
  })
  t.test('attribute a',t=>{
    const result = attributions.attribute('test','a',1)
    t.equal(result.a,'1')
    t.end()
  })
  t.test('attribute b',t=>{
    const result = attributions.attribute('test','b',1)
    t.equal(result.a,'1')
    t.equal(result.b,'1')
    t.end()
  })
  t.test('calcShare',t=>{
    const result = attributions.calculateShare('test','a')
    t.equal(result,.5)
    t.end()
  })
})

test('Balances',t=>{
  let balances
  t.test('init',t=>{
    balances = Balances()
    t.ok(balances)
    t.end()
  })
  t.test('create',t=>{
    const result = balances.create('test')
    t.equal(result,'0')
    t.end()
  })
  t.test('get',t=>{
    const result = balances.get('test')
    t.equal(result,'0')
    t.end()
  })
  t.test('add',t=>{
    const result = balances.add('test',2)
    t.equal(result,'2')
    t.end()
  })
  t.test('sub',t=>{
    const result = balances.sub('test',1)
    t.equal(result,'1')
    t.end()
  })
  t.test('snapshot',t=>{
    const result = balances.snapshot()
    t.equal(result.test,'1')
    t.end()
  })
})

test('History',t=>{
  let history
  t.test('init',t=>{
    history = History()
    t.ok(history)
    t.end()
  })
  t.test('insert',t=>{
    history.insert({blockNumber:1,balance:1})
    t.end()
  })
  t.test('lookup',t=>{
    const result = history.lookup(1)
    t.equal(result.balance,1)
    t.equal(result.blockNumber,1)
    t.end()
  })
})

test('BalanceHistories',t=>{
  let histories
  t.test('init',t=>{
    histories = BalanceHistories()
    t.ok(histories)
    t.end()
  })
  t.test('create',t=>{
    const result = histories.create('test')
    t.ok(result)
    t.end()
  })
  t.test('insert',t=>{
    histories.insert('test',{blockNumber:1,balance:1})
    t.end()
  })
  t.test('lookup',t=>{
    const result = histories.lookup('test',2)
    t.ok(result)
    t.equal(result.balance,1)
    t.end()
  })
})

test('Attributions',t=>{
  let attributions
  t.test('init',t=>{
    attributions = Attributions()
    t.ok(attributions)
    t.end()
  })
  t.test('add',t=>{
    const result = attributions.add('a',1)
    t.ok(result)
    t.end()
  })
  t.test('sub',t=>{
    attributions.add('b',1)
    const result = attributions.sub('b',1)
    t.equal(result,0)
    t.end()
  })
  t.test('sum',t=>{
    const result = attributions.getSum()
    t.equal(result,1)
    t.end()
  })
  t.test('getPercent',t=>{
    const result = attributions.getPercent('a')
    t.equal(result,1)
    t.end()
  })
  t.test('listPercents',t=>{
    const result = attributions.listPercents()
    t.equal(result.a,1)
    t.notOk(result.b)
    t.end()
  })
})
