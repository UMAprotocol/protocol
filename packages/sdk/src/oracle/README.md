# Oracle Client

# Architecture

WIP

```js
type services = {
  [chainId:number]:{
    transactionManager:Service;
    erc20s:{
      [address:string]:{
        balances:Service;
        allowances:Service;
        service:Service;
      }
    }
    optimisticOracle:{
      [address:string]:{
        state:Service;
        contract:Service;
      }
    }
    lsps:{
      [address:string]:{
        state:Service;
        contract:Service;
      }
    }
  }
  user: Service;
  state: Service;
  app: Service;
}
```
