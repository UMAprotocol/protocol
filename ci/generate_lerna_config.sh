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
            echo: "No packages for testing."
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

  for PACKAGE in "${PACKAGES_ARRAY[@]}"
    do
      cat <<EOF >> $CI_CONFIG_FILE
    test-${PACKAGE:5}:
      docker:
        - image: circleci/node:lts
        - image: trufflesuite/ganache-cli
          command: ganache-cli -i 1234 -l 9000000 -p 9545
      working_directory: ~/protocol
      steps:
        - restore_cache:
            key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
        - run:
            name: Run tests
            command: |
              ./ci/truffle_workaround.sh
              export PACKAGES_CHANGES=$PACKAGE
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
              echo: "All tests running successfully"
              circleci-agent step halt;
EOF


  printf "\n\nworkflows:\n  version: 2.1\n  build_and_test:\n    jobs:\n" >> $CI_CONFIG_FILE

  for PACKAGE in "${PACKAGES_ARRAY[@]}"
    do
      cat <<EOF >> $CI_CONFIG_FILE
      - test-${PACKAGE:5}:
          context: api_keys
EOF
  done

  printf "      - tests-required:\n          requires:\n" >> $CI_CONFIG_FILE

  for PACKAGE in "${PACKAGES_ARRAY[@]}"
    do
      cat <<EOF >> $CI_CONFIG_FILE
            - test-${PACKAGE:5}
EOF
  done

fi
