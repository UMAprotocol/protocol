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

# Auth service account
echo $GCLOUD_SERVICE_KEY | gcloud auth activate-service-account --key-file=-
gcloud --quiet config set project ${GOOGLE_PROJECT_ID}
gcloud --quiet config set compute/zone ${GOOGLE_COMPUTE_ZONE}

# Copy the staging config into the voter-dapp dir.
gsutil cp gs://staging-deployment-configuration/voter-app.yaml voter-dapp/app.yaml

# Deploy voter dapp
./scripts/deploy_dapp.sh voter-dapp voter-dapp/app.yaml -q
