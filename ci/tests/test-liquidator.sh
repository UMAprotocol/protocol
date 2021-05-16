#!/bin/bash

TESTS_GLOB=$1
TESTS_FILE=$2

cat << EOF
  test-liquidator-package:
    docker:
      - image: circleci/node:lts
      - image: trufflesuite/ganache-cli
        command: ganache-cli -i 1234 -l 9000000 -p 9545
    working_directory: ~/protocol
    resource_class: medium+
    parallelism: 10
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Run mocha tests
          command: |
            cd packages/liquidator
            yarn mocha mocha-test
      - run:
          name: Run tests
          command: |
            ./ci/truffle_workaround.sh
            pwd
            cd packages/liquidator
            echo $TESTS_GLOB
            circleci tests glob "test/**/*.js" | circleci tests split > /tmp/test-files
            yarn hardhat test ./$TESTS_FILE
EOF
