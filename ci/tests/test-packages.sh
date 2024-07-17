#!/bin/bash

PACKAGE=$1

cat << EOF
  test-${PACKAGE:5}:
    docker:
      - image: cimg/node:lts
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
            export PATH="$PATH:/home/circleci/.foundry/bin"
            yarn test --scope ${PACKAGE};
EOF
