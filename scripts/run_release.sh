#!/usr/bin/env bash
set -e

yarn run publish-release-npm --yes

for TAG in $(yarn --silent lerna ls -p --long -a | cut -d: -f2-3 | tr : @)
do
    echo "Attempting to publish tag: $TAG"
    git tag -a "$TAG" -m "$TAG" || echo "Not publishing $TAG since it already exists"
done

git push origin --tags
