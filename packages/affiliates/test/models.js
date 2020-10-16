const test = require('tape')
const lodash = require("lodash");
const {BalanceHistory,BalanceHistories,Attributions} = require('../libs/models')

test('BalanceHistory',t=>{
  let history
  t.test('init',t=>{
    history = BalanceHistory()
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
