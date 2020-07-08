if [ $# -ne 6 ]; then
    echo "Incorrect number of arguments supplied! You provided $# arguments are:"
    echo "1) Scheduler name"
    echo "2) Schedular cron time"
    echo "3) Target HTTP URL"
    echo "4) Scheduler service account"
    echo "5) HTTP JSON body"
    echo "6) Scheduler description"
    exit 1
fi

echo "🔥 Creating scheduler with the following params:"
echo "Scheduler Name:" $1
echo "Schedular cron time" $2
echo "Target HTTP URL:" $3
echo "Service Account:" $4
echo "HTTP JSON body:" $5
echo "Scheduler description:" $6

gcloud scheduler jobs create http $1 \
    --schedule="$2" \
    --uri=$3 \
    --oidc-service-account-email=$4 \
    --http-method=post \
    --message-body=$5 \
    --headers="Authorization=key=AUTHKEY, Content-Type=application/json" \
    --description="$6"
echo "🎊 Scheduler created!"
