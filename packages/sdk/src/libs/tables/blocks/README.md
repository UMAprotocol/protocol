# Blocks Table

Defines an ethereum block type and returns a base table typed to that. Currently exposes a js-map compatible table.

## Usage

See [tests](./js-map.test.ts) for more example usage.

```js
  import uma from '@uma/sdk'
  const Table = uma.tables.Blocks.JsMap
  const Store = uma.stores.JsMap

  type Data = {
    name:string;
    age:number;
    verified?:boolean;
  }
  // required to uniquely identify data
  function makeId(data:Data){
    return data.name
  }

  // create a store that accepts a string key and string value
  const store = Store<string,D>()
  const table = Table<string,D>({makeId,type:'user'},store)

  let user = await table.create({ name:'john',age:20 })
  // returns {id:'john',name:'john',age:20})

  // set data directly, replaces old data
  user = await table.set({...user,verified:false})
  // returns {id:'john',name:'john',age:20, verified:false})

  // update user with partial data
  user = await table.update(user.id,{verified:true})
  // returns {id:'john',name:'john',age:20, verified:true})

```

## Types

Found in [index.d.ts](./index.d.ts)

```js
import type { BlockType } from "@uma/sdk"
;``
```
