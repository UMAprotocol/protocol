#!/usr/bin/env bash
set -e

# Inject the npm token into the npm config.
npm config set '//registry.npmjs.org/:_authToken' "${NPM_TOKEN}"

# Publish any packages whose versions are not present in the registry.
yarn lerna publish from-package --yes

# Set a name and email in git if there isn't one already defined
git config --get user.email || git config user.email ci@umaproject.org
git config --get user.name || git config user.name "Continuous Integration"

# Create git tags for any tags that don't exist in the repo.
# TODO: this is not explicitly synced with the step above.
# For now, if this causes a difference, the git tags will need to be manually replaced.
for TAG in $(yarn --silent lerna ls -p --long -a | cut -d: -f2-3 | tr : @)
do
    echo "Attempting to publish tag: $TAG"
    git tag -a "$TAG" -m "$TAG" || echo "Not publishing $TAG since it already exists"
done

git push origin --tags
