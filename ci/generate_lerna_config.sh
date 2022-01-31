#!/bin/bash

set -o errexit
set -o nounset

PACKAGES_ARRAY=($(cat lerna_packages))
CI_CONFIG_FILE=".circleci/lerna_config.yml"
TESTS_PATH="ci/tests"

if [ ${#PACKAGES_ARRAY[@]} -eq 0 ]; then
  /bin/bash $TESTS_PATH/test-not-required.sh >> $CI_CONFIG_FILE
else

  echo "Packages to test:"
  echo ${PACKAGES_ARRAY[*]}

  printf "version: 2.1\n\njobs:\n" >> $CI_CONFIG_FILE

  # TODO: add back these tests when optimism plays nicely with CI.
  # /bin/bash $TESTS_PATH/test-integration.sh >> $CI_CONFIG_FILE

  if [[ " ${PACKAGES_ARRAY[@]} " =~ " @uma/financial-templates-lib " ]]; then
      /bin/bash $TESTS_PATH/test-financial-templates-lib.sh >> $CI_CONFIG_FILE
  fi

  if [[ " ${PACKAGES_ARRAY[@]} " =~ " @uma/liquidator " ]]; then
      /bin/bash $TESTS_PATH/test-liquidator.sh >> $CI_CONFIG_FILE
  fi

  for PACKAGE in "${PACKAGES_ARRAY[@]}"
    do
      /bin/bash $TESTS_PATH/test-packages.sh $PACKAGE >> $CI_CONFIG_FILE
  done

  /bin/bash $TESTS_PATH/test-required.sh >> $CI_CONFIG_FILE

  /bin/bash ci/dockerhub.sh >> $CI_CONFIG_FILE

  printf "\n\nworkflows:\n  version: 2.1\n  build_and_test:\n    jobs:\n" >> $CI_CONFIG_FILE

  if [[ " ${PACKAGES_ARRAY[@]} " =~ " @uma/financial-templates-lib " ]]; then
    REMOVE=@uma/financial-templates-lib
    PACKAGES_ARRAY=( "${PACKAGES_ARRAY[@]/$REMOVE}" )
    PACKAGES_ARRAY+=("@uma/financial-templates-lib-hardhat")
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

  # printf "      - test-integration\n" >> $CI_CONFIG_FILE

  printf "      - tests-required:\n          requires:\n" >> $CI_CONFIG_FILE

  for PACKAGE in "${WORKFLOW_JOBS[@]}"
    do
      cat <<EOF >> $CI_CONFIG_FILE
            - test-${PACKAGE:5}
EOF
  done

  # printf "            - test-integration" >> $CI_CONFIG_FILE
  /bin/bash ci/dockerhub_workflow.sh >> $CI_CONFIG_FILE

fi
