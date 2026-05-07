# Base44 migration checklist

1. Inventory all Base44 SDK/runtime touchpoints
2. Replace each feature with backend endpoint + frontend API client usage
3. Verify parity in staging with user acceptance tests
4. Migrate data to owned database
5. Shadow traffic and compare responses/metrics
6. Cut over DNS/traffic after validation
7. Keep rollback window and playbook active until stable
