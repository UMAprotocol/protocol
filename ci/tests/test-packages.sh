#!/bin/bash

PACKAGE=$1

cat << EOF
  test-${PACKAGE:5}:
    docker:
      - image: circleci/node:16.17.0
      - image: trufflesuite/ganache-cli
        command: ganache-cli -i 1234 -l 9000000 -p 9545
    working_directory: ~/protocol
    resource_class: large
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Run tests
          command: |
            yarn test --scope ${PACKAGE};
EOF
