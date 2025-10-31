Test Url For Purchase:
https://sqwad-test-store-plus.myshopify.com/

Create a webhook:
shopify app webhook trigger \
--topic orders/create \
--api-version 2025-10 \
--address https://parliament-touring-maple-proceedings.trycloudflare.com/webhooks/refunds/create 


To start:
Set to node 22- nvm use 22
shopify app dev --store sqwad-test-store-plus
