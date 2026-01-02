#!/bin/bash
# Test Edge Functions manually
# Requires SUPABASE_URL and SUPABASE_ANON_KEY environment variables

set -e

SUPABASE_URL="${SUPABASE_URL:-https://zcvwamziybpslpavjljw.supabase.co}"
EDGE_FUNCTION_URL="${SUPABASE_URL}/functions/v1"

echo "🧪 Testing Edge Functions"
echo "=========================="
echo ""

echo "1. Testing get-current-quiz..."
curl -X GET "${EDGE_FUNCTION_URL}/get-current-quiz" \
  -H "Content-Type: application/json" \
  -w "\nStatus: %{http_code}\n" \
  | jq '.' || echo "Response received"
echo ""

echo "2. Testing publish-quiz (should return no draft quiz if none ready)..."
curl -X POST "${EDGE_FUNCTION_URL}/publish-quiz" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -w "\nStatus: %{http_code}\n" \
  | jq '.' || echo "Response received"
echo ""

echo "✅ Edge Function tests complete"
echo ""
echo "Note: To test authenticated endpoints (start-attempt, submit-answer, etc.),"
echo "you need to:"
echo "  1. Create a test user via Supabase Auth"
echo "  2. Get their JWT token"
echo "  3. Include it in Authorization header: Bearer <token>"

