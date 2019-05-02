pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title ResultComputation
 * @dev Computes the results of voting on a data value. The voted values, along with their weights, are kept in a sorted
 * linked list as votes come in. The result is the weighted median of the values, computed by iterating over the list
 * when needed.
 * TODO(ptare): All methods are internal because we don't have a migration system written yet, so libraries with public
 * methods can't yet be linked to from unit tests. 
 */
library ResultComputation {
    using SafeMath for uint;

    uint private constant NULL_NODE_ID = 0;

    struct LinkedListNode {
        // The total number of tokens that voted for this value.
        uint weight;
        // The value this node encapsulates.
        int value;
        // Pointer to the next node.
        uint next;
    }

    // All the data that needs to be stored to compute results.
    struct ResultComputationData {
        // Must be initialized to NULL_NODE_ID. Don't need to do any initialization as long as NULL_NODE_ID == 0.
        uint head;
        // The linked list is stored in a mapping from (node #) => node. Each node's next pointer contains the (node #)
        // of the next node.
        mapping(uint => LinkedListNode) linkedList;

        // The total weight (total number of tokens) that have voted so far.
        uint totalWeight;
        // Number of nodes in the list. Might be able to do something cheeky and use totalWeight instead.
        uint numberNodes;
    }

    // Calculates the average of two numbers. Since these are integers, averages of an even and odd number cannot be
    // represented, and will be rounded down. Signed integer version of OpenZeppelin's Math.average.
    function average(int a, int b) internal pure returns (int) {
        // (a + b) / 2 can overflow, so we distribute.
        return (a / 2) + (b / 2) + ((a % 2 + b % 2) / 2);
    }

    /**
     * @dev Iterates through the linked list in ResultComputationData and returns the median.
     */
    function getResolvedPrice(ResultComputationData storage data) internal view returns (int) {
        // TODO(ptare): Figure out what API is used to communicate invalid results.
        require(data.totalWeight > 0, "Invalid resolved price: no votes were added");

        uint node = data.head;
        uint fiftyPercentile = data.totalWeight.div(2);
        uint accumulatedWeight = 0;
        while (node != NULL_NODE_ID) {
            accumulatedWeight = accumulatedWeight.add(data.linkedList[node].weight);
            uint next = data.linkedList[node].next;
            // If the accumulatedWeight is *exactly* half of the total weight, then the median is the mean average of
            // this node's value and the next node's value. The next node will always exist in the list if
            // accumulatedWeight is less than 100%.
            if (accumulatedWeight == fiftyPercentile) {
                return average(data.linkedList[node].value, data.linkedList[next].value);
            }
            // This node contains the 50th percentile.
            if (accumulatedWeight > fiftyPercentile) {
                return data.linkedList[node].value;
            }
            node = next;
        }
        // Should never get here.
    }

    function _insertNodeAtHead(ResultComputationData storage data, int votePrice, uint numberTokens) internal {
        uint newNodeIndex = data.numberNodes.add(1);
        data.numberNodes = newNodeIndex;
        data.linkedList[newNodeIndex] = LinkedListNode(numberTokens, votePrice, data.head);
        data.head = newNodeIndex;
    }

    function _insertNodeAfter(ResultComputationData storage data, uint node, int votePrice, uint numberTokens) internal {
        uint newNodeIndex = data.numberNodes.add(1);
        data.numberNodes = newNodeIndex;
        data.linkedList[newNodeIndex] = LinkedListNode(numberTokens, votePrice, data.linkedList[node].next);
        data.linkedList[node].next = newNodeIndex;
    }

    /**
     * @dev Adds a new vote's value to be used when computing the result.
     */
    function addVote(ResultComputationData storage data, int votePrice, uint numberTokens) internal {
        data.totalWeight = data.totalWeight.add(numberTokens);

        // Insert first node or node at head of non-empty list.
        if (data.head == NULL_NODE_ID || votePrice < data.linkedList[data.head].value) {
            _insertNodeAtHead(data, votePrice, numberTokens);
            return;
        }

        uint node = data.head;
        while(data.linkedList[node].next != NULL_NODE_ID) {
            // Found a node with the same value, join that current node instead of creating a new node.
            if (votePrice == data.linkedList[node].value) {
                data.linkedList[node].weight = data.linkedList[node].weight.add(numberTokens);
                return;
            }

            // We've found the node to insert after.
            if (votePrice < data.linkedList[data.linkedList[node].next].value) {
                break;
            }
            node = data.linkedList[node].next;
        }

        // Insert after node, which could be the tail of the list if we never broke out of the above while loop.
        _insertNodeAfter(data, node, votePrice, numberTokens);
    }
}
