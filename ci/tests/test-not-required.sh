#!/bin/bash

cat << EOF
version: 2.1
jobs:
  tests-required:
    docker:
      - image: cimg/node:lts
    steps:
      - run:
          name: Test dependencies
          command: |
            echo "No packages for testing."
            circleci-agent step halt;

workflows:
  version: 2.1
  build_and_test:
      jobs:
        - tests-required
EOF
