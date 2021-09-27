# Base Table

Contains basic functions you want in your tables. Also allows you to compose stores and tables
with custom data types outside of the sdk if desired.

## Usage

See [tests](./base.test.ts) for more example usage.

```js
  import { stores, tables } from '@uma/sdk'
  const Table = uma.tables.base
  const JsMapStore = uma.stores.JsMap

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
  const store = JsMapStore<string,D>()
  const table = Table<string,D, stores.Store<string,D>>({makeId,type:'user'},store)

  let user = await table.create({ name:'john',age:20 })
  // returns {id:'john',name:'john',age:20})

  // set data directly, replaces old data
  user = await table.set({...user,verified:false})
  // returns {id:'john',name:'john',age:20, verified:false})

  // update user with partial data
  user = await table.update(user.id,{verified:true})
  // returns {id:'john',name:'john',age:20, verified:true})

```
