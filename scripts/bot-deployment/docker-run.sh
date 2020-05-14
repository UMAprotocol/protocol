docker run -it --env MNEMONIC="saddle invest fever fruit broccoli foam man detail someone client offer pool" \
    --env PAGERDUTY_API_KEY="5akBysuAfzMZHsh_oFCP" \
    --env PAGERDUTY_SERVICE_ID="PQWHBOB" \
    --env PAGERDUTY_FROM_EMAIL="chris@umaproject.org" \
    --env SLACK_WEBHOOK="https://hooks.slack.com/services/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" \
    --env EMP_ADDRESS="0xDe15ae6E8CAA2fDa906b1621cF0F7296Aa79d9f1" \
    --env PRICE="0.0225" \
    --env POLLING_DELAY="30000" \
    --env BOT_MONITOR_OBJECT='[{"name":"UMA liquidator bot","address":"0xf16B3B4bf2E21B04A9BF771863D06ECE3585daB7","collateralThreshold":"500000000000000000000","syntheticThreshold":"200000000000000000000000","etherThreshold":"500000000000000000"},{"name":"UMA disputer Bot","address":"0x11f046dbb6da288320944e514322cA4CA9be5c89","collateralThreshold":"1500000000000000000000","syntheticThreshold":"0","etherThreshold":"500000000000000000"}]' \
    --env WALLET_MONITOR_OBJECT='[{"name":"UMA sponsor wallet","address":"0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D","crAlert":140}]' \
    --env COMMAND="npx truffle exec ../monitors/index.js --network kovan_mnemonic" \
    chrismaree/voting:hotfix
