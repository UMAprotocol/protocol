/*
  PriceTime Library
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


library PriceTime {
    using SafeMath for uint;
    using PriceTime for Data[];

    struct Data {
        int price;
        uint time;
    }

    function _mergeArray(Data[] storage self, Data[] memory mergingArray, uint interval) internal {
        require(mergingArray.length > 0);
        uint index = self._getIndex(mergingArray[0].time, interval);

        uint currentLength = self.length;

        for (uint i = 0; i < mergingArray.length; i = i.add(1)) {
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

    function _getBestPriceTimeForTime(Data[] storage self, uint time, uint lengthToConsider, uint interval)
        internal
        view
        returns (uint publishTime, int price)
    {
        if (lengthToConsider == 0 || time < self[0].time) {
            return (0, 0);
        }

        uint idx = lengthToConsider.sub(1);

        if (time < self[idx].time) {
            idx = self._getIndex(time.div(interval).mul(interval), interval);
        }

        Data storage priceTime = self[idx];

        return (priceTime.time, priceTime.price);
    }
}
