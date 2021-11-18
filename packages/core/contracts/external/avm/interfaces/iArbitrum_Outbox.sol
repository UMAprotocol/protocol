// Copied logic from https://github.com/OffchainLabs/arbitrum-tutorials/blob/4761fa1ba1f1eca95e8c03f24f1442ed5aecd8bd/packages/arb-shared-dependencies/contracts/Outbox.sol
// with changes only to the solidity version.

// SPDX-License-Identifier: Apache-2.0

/*
 * Copyright 2021, Offchain Labs, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

pragma solidity ^0.8.0;

interface iArbitrum_Outbox {
    function l2ToL1Sender() external view returns (address);
}
