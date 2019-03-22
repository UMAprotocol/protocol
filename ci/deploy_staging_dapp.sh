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

# Copy the staging config into the sponsor-dapp dir.
gsutil cp gs://staging-deployment-configuration/app.yaml sponsor-dapp/app.yaml

# Deploy dapp
OUTPUT=./scripts/deploy_dapp.sh sponsor-dapp/app.yaml -q

# We must grep the output because gcloud permissioning issues don't return a nonzero exit code.
set +e
echo "$OUTPUT"
NUM_FAILURES=$(echo "$OUTPUT" | grep -ci "Deployment failed")
if [ $NUM_FAILURES -ne 0 ]
then
    # If we found failures, exit nonzero.
    exit 1
fi

# If we get here make sure to exit 0.
# Note: this is necessary because grep returns a nonzero exit code if it finds nothing.
exit 0
