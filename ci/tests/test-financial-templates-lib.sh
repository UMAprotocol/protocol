#!/bin/bash

cat << EOF
  test-financial-templates-lib-hardhat:
    docker:
      - image: circleci/node:lts
      - image: trufflesuite/ganache-cli
        command: ganache-cli -i 1234 -l 9000000 -p 9545
    working_directory: ~/protocol
    resource_class: medium+
    parallelism: 35
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Run tests
          command: |
            ./ci/truffle_workaround.sh
            pwd
            cd packages/financial-templates-lib
            circleci tests glob "test/**/*.js" | circleci tests split > /tmp/test-files
            yarn hardhat test ./$(echo '$(cat /tmp/test-files)')
  test-financial-templates-lib-truffle:
    docker:
      - image: circleci/node:lts
      - image: trufflesuite/ganache-cli
        command: ganache-cli -i 1234 -l 9000000 -p 9545
    working_directory: ~/protocol
    resource_class: medium+
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Run tests
          command: |
            ./ci/truffle_workaround.sh
            pwd
            cd packages/financial-templates-lib
            yarn truffle test test-truffle/*
EOF
