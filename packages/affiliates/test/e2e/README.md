# End To End Tests

These tests run the entire stack and reach out to external services or write to disk. The idea is that you can test
as if you were in "production" as a last check to make sure everything works. These should be run locally, but maybe
in the future they can be added to CI in some way.

## Running

`yarn test-e2e`

These tests may make a folder inside your workign directory to temporarily save files to. Its possible that
if the tests fail, this folder may not be cleaned up, and may require either fixing the tests or manually
deleting the folder if this happens. Look for a folder inside your working directory called `test-datasets`
if that happens.
