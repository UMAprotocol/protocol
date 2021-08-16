# JS Map Store

This store is a simple cache which wraps an underlying Map. All stores functions are async, unlike a map.

## Usage

See [tests](./store.test.ts) for more example usage.

```js
  import uma from '@uma/sdk'
  const Store = uma.stores.JsMap
  // create a store that accepts a string key and string value
  const store = Store<string,string>()
  await store.set('a','b')
  console.log(await store.has('a')) // true
  console.log(await store.has('b')) // false
  console.log(await store.get('a')) // 'b'
  console.log(await store.delete('b'))
  console.log(await store.has('a')) // false

  // initialize store with a pre warmed map
  const map = new Map<string,string>(['a','b'])
  const store = Store<string,string>(map)
  console.log(await store.has('a')) // true
```
