# Google Datastore Store

This store wraps the google-cloud/datastore client to match the store interface.

## Usage

See [tests](./store.test.ts) for more example usage.

```js
import uma from "@uma/sdk"
const Store = uma.stores.GoogleDatastore
type Data = {
  name: string,
  age: number,
}
const datastore = new Datastore()

// create a store that accepts a Data value
const store = Store < Data > ("users", datastore)

await store.set("john", { name: "john", age: 23 })

console.log(await store.has("john")) // true
console.log(await store.has("larry")) // false
console.log(await store.get("john")) // {name:'john',age:23}
console.log(await store.delete("john"))
console.log(await store.has("john")) // false
```
