# Sorted JS Map Store

This wraps a JS map, but also includes a sorted array which allows you to query data between keys. Useful
for time series data or anything that needs to be ordered. Uses lodash binary searches under the hood
so queries and updates should be O(log(N)).

## Usage

See [tests](./store.test.ts) for more example usage.

```js
  import uma from '@uma/sdk'
  const Store = uma.stores.SortedJsMap

  // define your type
  type Price = {
    id?: string;
    timestamp: number;
    identifier: string;
    price: number;
  };
  // define your id function ( for sorting). Will sort ascending.
  function makeId(data: Price) {
    return [data.identifier, data.timestamp.toString().padStart(4, "0")].join("!");
  }

  // create a store that accepts a string key and string value
  const store = Store<string, Price>();

  const prices: Price[] = [
    { timestamp: 10, identifier: "a", price: 100 },
    { timestamp: 11, identifier: "a", price: 99 },
    { timestamp: 9, identifier: "a", price: 98 },
    { timestamp: 2, identifier: "a", price: 82 },
    { timestamp: 13, identifier: "a", price: 101 },
  ]

  // adding some prices in random order
  prices.forEach((price) => store.set(makeId(price), price));
  // querying between keys, use tilde "~" to represent a large ascii character
  const result = await map.between("a", "a~~");
  // returns all prices with the "a" identifier, sorted from lowest to highest TS

  // See more examples in the test file.

```
