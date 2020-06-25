if [ $# -ne 5 ]; then
    echo "Incorrect number of arguments supplied! arguments are:"
    echo "1) Scheduler name"
    echo "2) Target HTTP URL"
    echo "3) Scheduler service account"
    echo "4) HTTP JSON body"
    echo "5) Scheduler description"
    exit 1
fi

echo "🔥 Creating scheduler with the following params:"
echo "Scheduler Name:" $1
echo "Target HTTP URL:" $2
echo "Service Account:" $3
echo "HTTP JSON body:" $4
echo "Scheduler description:" $5

gcloud scheduler jobs create http $1 \
    --schedule="0 12 * * *" \
    --uri=$2 \
    --oidc-service-account-email=$3 \
    --http-method=post \
    --message-body=$4 \
    --headers="Authorization=key=AUTHKEY, Content-Type=application/json" \
    --description="$5"
echo "🎊 Scheduler created!"
