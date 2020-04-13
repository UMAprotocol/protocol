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

# Copy the staging config into the voter-dapp dir
gsutil cp gs://staging-deployment-configuration/voter-app.yaml voter-dapp/app.yaml

# Deploy docs
./scripts/deploy_docs.sh documentation/gae_app.yaml -q

