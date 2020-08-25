#!/usr/bin/env bash
set -e

# Downloading gcloud package
curl https://dl.google.com/dl/cloudsdk/release/google-cloud-sdk.tar.gz > /tmp/google-cloud-sdk.tar.gz

# Installing the package
sudo mkdir -p /usr/local/gcloud \
  && sudo tar -C /usr/local/gcloud -xvf /tmp/google-cloud-sdk.tar.gz \
  && sudo /usr/local/gcloud/google-cloud-sdk/install.sh -q

# Adding the package path to local
export PATH=$PATH:/usr/local/gcloud/google-cloud-sdk/bin

# Save the gcloud credentials to a json file
GCLOUD_FNAME=$(mktemp -q --suffix=.json)
echo $GCLOUD_SERVICE_KEY > $GCLOUD_FNAME

# Auth service account
gcloud auth activate-service-account --key-file=$GCLOUD_FNAME
gcloud --quiet config set project ${GOOGLE_PROJECT_ID}
gcloud --quiet config set compute/zone ${GOOGLE_COMPUTE_ZONE}

# Pull down dapp configs.
gsutil cp gs://dapp-configs/staging-voter-app.yaml packages/voter-dapp/
gsutil cp gs://dapp-configs/prod-voter-app.yaml packages/voter-dapp/

# Deploy voter dapp to staging. This will immediately update the service to point traffic to this version.
./scripts/deploy_dapp.sh packages/voter-dapp packages/voter-dapp/staging-voter-app.yaml -q

# Upload a new prod version. --no-promote means that traffic will not be migrated to this version.
# That will be done manually through the release process.
./scripts/deploy_dapp.sh packages/voter-dapp packages/voter-dapp/prod-voter-app.yaml -q --no-promote

# Clean up dapp configs
rm -rf packages/voter-dapp/staging-voter-app.yaml packages/voter-dapp/prod-voter-app.yaml

# Deploy docs
./scripts/deploy_docs.sh documentation/gae_app.yaml -q

# Delete old versions.

# This (rather complicated command) aims to select the oldest versions to delete:
# 1. Filters out any versions that are set to receive traffic.
# 2. Sorts the non-traffic receiving versions such that the ones with the smallest version ID coming last.
#    Note: default verion ids are essentially timestamps (YYYYMMDDtHHMMSS), so as long as the defaults are used, this
#    sorting scheme is the same as newest-first.
# 3. Prints the sorted version IDs as a list.
# 4. Pipes that list to tail which only takes those starting at line 100 (filtering out the newest 99, effectively).
# 5. Stores the result in VERSIONS_TO_DELETE.
VERSIONS_TO_DELETE=$(gcloud app versions list --filter="TRAFFIC_SPLIT=0.00" --sort-by="~VERSION.ID" --format="value(VERSION.ID)" | tail -n +100)

# If VERSIONS_TO_DELETE is empty (the first command succeeds), then don't run the delete command.
# If VERSIONS_TO_DELETE is non empty, run the command and delete the specified versions.
[ -z "$VERSIONS_TO_DELETE" ] || gcloud app versions delete -q $VERSIONS_TO_DELETE
