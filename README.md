Test Url For Purchase:
https://sqwad-test-store-plus.myshopify.com/

Create a webhook:
shopify app webhook trigger \
--topic orders/create \
--api-version 2025-10 \
--address https://sqwad-prediction-rebate-f95e19863c03.herokuapp.com/webhooks/refunds/create 


To start:
Set to node 22- nvm use 22
shopify app dev --store sqwad-test-store-plus

Environment:
- `SHOPIFY_APP_URL` should match your tunnel/application URL (same as `APP_URL`).
- `SQWAD_ACTIVE_GAME_API_BASE` should point to the same host so checkout extensions can query `/api/active-game`.
- Production host: `https://sqwad-prediction-rebate-f95e19863c03.herokuapp.com`
