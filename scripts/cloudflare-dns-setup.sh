#!/usr/bin/env bash
#
# Create play10q.com DNS records in Cloudflare via API.
# Run this AFTER adding play10q.com to Cloudflare and updating nameservers at GoDaddy.
#
# Required:
#   CLOUDFLARE_API_TOKEN  - API token with "DNS Edit" for the zone
#   CLOUDFLARE_ZONE_ID    - Zone ID for play10q.com (from Cloudflare dashboard → Overview)
#
# Usage:
#   export CLOUDFLARE_API_TOKEN="your_token"
#   export CLOUDFLARE_ZONE_ID="your_zone_id"
#   ./scripts/cloudflare-dns-setup.sh
#
# Or one-liner:
#   CLOUDFLARE_API_TOKEN="..." CLOUDFLARE_ZONE_ID="..." ./scripts/cloudflare-dns-setup.sh

set -e

BASE_URL="https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID}/dns_records"
AUTH_HEADER="Authorization: Bearer ${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"

# Records to create (matches current GoDaddy setup for play10q.com)
# Proxied is false so behavior matches current setup; you can enable proxy later in dashboard.

create_record() {
  curl -sS -X POST "$BASE_URL" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    --data "$1"
  echo ""
}

echo "Creating A record @ -> 199.36.158.100"
create_record '{"type":"A","name":"play10q.com","content":"199.36.158.100","ttl":1,"proxied":false}'

echo "Creating CNAME www -> rileycevans.github.io"
create_record '{"type":"CNAME","name":"www.play10q.com","content":"rileycevans.github.io","ttl":1,"proxied":false}'

echo "Creating CNAME pay -> paylinks.commerce.godaddy.com"
create_record '{"type":"CNAME","name":"pay.play10q.com","content":"paylinks.commerce.godaddy.com","ttl":1,"proxied":false}'

echo "Creating TXT google-site-verification"
create_record '{"type":"TXT","name":"play10q.com","content":"google-site-verification=MEeCxPSRZARu8lAXR_uNkY1DxCTpE36ciRqMon3WMNc","ttl":1}'

echo "Creating TXT hosting-site"
create_record '{"type":"TXT","name":"play10q.com","content":"hosting-site=q-production-e4848","ttl":1}'

echo "Done. Check Cloudflare DNS tab for play10q.com."
