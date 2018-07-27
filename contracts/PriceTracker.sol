/*
   ETH/USD price ticker

   This contract keeps in storage an updated ETH/USD price,
   which is updated every ~60 seconds.
*/

pragma solidity ^0.4.22;
import "github.com/oraclize/ethereum-api/oraclizeAPI.sol";

contract PriceTicker is usingOraclize {
    
    string public ETHUSD;
    
    event newOraclizeQuery(string description);
    event newBTCPriceTicker(string price);
    

    function PriceTicker() {
        oraclize_setProof(proofType_TLSNotary | proofStorage_IPFS);
        update();
    }

    function __callback(bytes32 myid, string result, bytes proof) {
        if (msg.sender != oraclize_cbAddress()) throw;
        ETHUSD = result;
        newBTCPriceTicker(ETHUSD);
        update();
    }
    
    function update() payable {
        if (oraclize.getPrice("URL") > this.balance) {
            newOraclizeQuery("Oraclize query was NOT sent, please add some ETH to cover for the query fee");
        } else {
            newOraclizeQuery("Oraclize query was sent, standing by for the answer..");
            oraclize_query(60, "URL", "json(https://api.kraken.com/0/public/Ticker?pair=ETHUSD).result.XETHZUSD.c.0");
        }
    }
    
    function() payable {}
    
} 
