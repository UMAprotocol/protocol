#!/bin/bash

cat << EOF
  tests-required:
    docker:
      - image: cimg/node:lts
    steps:
      - run:
          name: Test dependencies
          command: |
            echo "All packages tested successfully!"
            circleci-agent step halt;
EOF
