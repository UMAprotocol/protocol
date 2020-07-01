#!/usr/bin/env bash
set -e

# Usage:
# ./scripts/deploy_dapp.sh <your_file.yaml> <additional_args_for_gcloud_app_deploy>

# Note: you must have the gcloud CLI tool installed and authenticated before using this script.
# Note: you must also have pandoc installed before running.

# Get the absolute path of a file.
# Credit: https://stackoverflow.com/a/21188136
get_abs_filename() {
  # $1 : relative filename
  echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
}

# Grab the absolute path for the provided file.
APP_YAML_PATH=$(get_abs_filename $1)

# Shift the arguments to provide to gcloud app deploy.
shift

# Build the docs site.
echo "Building docs site locally."
npx lerna bootstrap
./scripts/build_docs_site.sh

# Prepare for gcloud deploy.
echo "Moving files."
rm -rf build/docs
mkdir -p build/docs
cp -R build/site build/docs/www
cp $APP_YAML_PATH build/docs/
cd build/docs

# Deploy.
echo "Deploying."
gcloud app deploy gae_app.yaml "$@"

