# Automated voting system

The automated voting system assists UMA token holders cast their votes for price requests.

## Initial set up

Follow these steps to run the automated voting system on Google Cloud:

1. Log in to [Google Cloud](https://console.cloud.google.com). Create a new account if you don't have one.
2. Create a service account [here](https://console.cloud.google.com/iam-admin/serviceaccounts) by clicking `Create
   Service Account`.
3. Sign up for the [SendGrid](https:://app.sendgrid.com) service for sending email notifications with the email address
you want to use to send emails.
4. Get a SendGrid API key by clicking `Settings` -> `API Keys` -> `Create API Key`.
5. Create a new `Compute Engine` instance [here](https://console.cloud.google.com/compute/instances) by clicking `Create
   Instance` and configure it with the following steps.
   1. Click the box next to `Deploy a container image to this VM instance` and put in the URL for the UMA
automated voting system Docker image `<TODO FILL IN>`.
   2. Set the following environment variables: `<TODO FILL IN>`.

You'll receive an email notification when the system commits votes for a new round, at which point you'll be able to
review those commits.

## Redeploying

You may need to redeploy under certain circumstances. For example, you'll need to redeploy when a new identifier is
supported. To do so, use the following steps:
`<TODO FILL IN>`
