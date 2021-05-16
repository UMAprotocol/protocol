#!/bin/bash

set -o errexit
set -o nounset

PACKAGES_ARRAY=($(cat lerna_packages))
CI_CONFIG_FILE=".circleci/lerna_config.yml"

if [ ${#PACKAGES_ARRAY[@]} -eq 0 ]; then

  cat <<EOF >> $CI_CONFIG_FILE
version: 2.1

jobs:
  tests-required:
    docker:
      - image: circleci/node:lts
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

else

  echo "Packages to test:"
  echo ${PACKAGES_ARRAY[*]}

  printf "version: 2.1\n\njobs:\n" >> $CI_CONFIG_FILE

  if [[ " ${PACKAGES_ARRAY[@]} " =~ " @uma/financial-templates-lib " ]]; then

    cat <<EOF >> $CI_CONFIG_FILE
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
              echo $(circleci tests glob "test/**/*.js")
              circleci tests glob "test/**/*.js" | circleci tests split > /tmp/test-files
              yarn hardhat test ./$(cat /tmp/test-files)
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
  fi

  if [[ " ${PACKAGES_ARRAY[@]} " =~ " @uma/liquidator " ]]; then
    cat <<EOF >> $CI_CONFIG_FILE
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
              echo $(circleci tests glob "test/**/*.js")
              circleci tests glob "test/**/*.js" | circleci tests split > /tmp/test-files
              yarn hardhat test ./$(cat /tmp/test-files)
EOF
  fi

  for PACKAGE in "${PACKAGES_ARRAY[@]}"
    do
      cat <<EOF >> $CI_CONFIG_FILE
    test-${PACKAGE:5}:
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
              yarn test --scope ${PACKAGE};
EOF
  done

  cat <<EOF >> $CI_CONFIG_FILE
    tests-required:
      docker:
        - image: circleci/node:lts
      steps:
        - run:
            name: Test dependencies
            command: |
              echo "All tests running successfully"
              circleci-agent step halt;
EOF


  printf "\n\nworkflows:\n  version: 2.1\n  build_and_test:\n    jobs:\n" >> $CI_CONFIG_FILE

  if [[ " ${PACKAGES_ARRAY[@]} " =~ " @uma/financial-templates-lib " ]]; then
    REMOVE=@uma/financial-templates-lib
    PACKAGES_ARRAY=( "${PACKAGES_ARRAY[@]/$REMOVE}" )
    PACKAGES_ARRAY+=("@uma/financial-templates-lib-hardhat" "@uma/financial-templates-lib-truffle")
  fi

  if [[ " ${PACKAGES_ARRAY[@]} " =~ " @uma/liquidator " ]]; then
    REMOVE=@uma/liquidator
    PACKAGES_ARRAY=( "${PACKAGES_ARRAY[@]/$REMOVE}" )
    PACKAGES_ARRAY+=("@uma/liquidator-package")
  fi

    WORKFLOW_JOBS=()

    for i in "${PACKAGES_ARRAY[@]}"; do
    if [ -z "$i" ]; then
    continue
    fi
    WORKFLOW_JOBS+=("${i}")
    done

  for PACKAGE in "${WORKFLOW_JOBS[@]}"
    do
      cat <<EOF >> $CI_CONFIG_FILE
      - test-${PACKAGE:5}
EOF
  done

  printf "      - tests-required:\n          requires:\n" >> $CI_CONFIG_FILE

  for PACKAGE in "${WORKFLOW_JOBS[@]}"
    do
      cat <<EOF >> $CI_CONFIG_FILE
            - test-${PACKAGE:5}
EOF
  done

fi
