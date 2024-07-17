#!/bin/bash

cat << EOF
  test-financial-templates-lib-hardhat:
    docker:
      - image: cimg/node:lts
      - image: trufflesuite/ganache-cli
        command: ganache-cli -i 1234 -l 9000000 -p 9545
    working_directory: ~/protocol
    resource_class: medium+
    parallelism: 10
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Run tests
          command: |
            pwd
            cd packages/financial-templates-lib
            circleci tests glob "test/**/*.js" | circleci tests split > /tmp/test-files
            yarn mocha ./$(echo '$(cat /tmp/test-files)')
EOF
