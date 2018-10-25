/*
  PriceTime Library

  Implements an early version of VoteCoin protocols

  * ERC20 token
  * Uses Oraclize to fetch ETH/USD exchange rate
  * Allows users to vote yes/no on whether a price is accurate

*/
pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


library PriceTime {
    using SafeMath for uint;
    using PriceTime for Data[];

    struct Data {
        int256 price;
        uint time;
    }

    function _mergeArray(Data[] storage self, Data[] memory mergingArray, uint interval) internal {
        require(mergingArray.length > 0);
        uint index = self._getIndex(mergingArray[0].time, interval);

        uint currentLength = self.length;

        for (uint i = 0; i < mergingArray.length; ++i) {
            // TODO(mrice32): we can break this into two loops to save the branch once we've passed the end of
            // the existing array.
            uint storageIndex = i.add(index);
            require(i == 0
                || mergingArray[i.sub(1)].time.add(interval) == mergingArray[i].time);
            assert(storageIndex <= currentLength);
            if (storageIndex == currentLength) {
                currentLength = self.push(mergingArray[i]);
            } else {
                self[storageIndex] = mergingArray[i];
            }
        }
    }

    function _appendArray(Data[] storage self, Data[] storage mergingArray, uint interval)
        internal
    {
        require(self._getIndex(mergingArray[0].time, interval) == self.length);
        self._mergeArray(mergingArray, interval);
    }

    function _getIndex(Data[] storage self, uint time, uint interval) internal view returns (uint idx) {
        require(time.mod(interval) == 0);
        if (self.length == 0) {
            idx = 0;
        } else {
            uint timeDiff = time.sub(self[0].time);
            idx = timeDiff.div(interval);
            require(idx <= self.length);
        }
    }
}