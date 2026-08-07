#!/bin/bash

# API Test Script for Aquaculture IoT Platform
BASE_URL="http://localhost:3000/api"
TOKEN=""

echo "🧪 Starting API Tests..."
echo "================================"

# Test 1: Health Check
echo -e "\n1. Testing Health Endpoint..."
curl -s "$BASE_URL/../health" | jq .

# Test 2: Register New Organization
echo -e "\n2. Registering New Organization..."
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@fishfarm.com",
    "password": "SecurePass123!",
    "organizationName": "Test Fish Farm",
    "role": "OWNER"
  }')

echo $REGISTER_RESPONSE | jq .

# Extract token
TOKEN=$(echo $REGISTER_RESPONSE | jq -r '.data.token')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token. Trying login..."
  LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@fishfarm.com",
      "password": "SecurePass123!"
    }')
  TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.data.token')
fi

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Authentication failed. Exiting tests."
  exit 1
fi

echo "✅ Token obtained: ${TOKEN:0:20}..."

# Test 3: Get Current User Profile
echo -e "\n3. Getting User Profile..."
curl -s "$BASE_URL/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Test 4: Create Farm
echo -e "\n4. Creating Farm..."
FARM_RESPONSE=$(curl -s -X POST "$BASE_URL/farms" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Main Fish Farm",
    "code": "FARM-001",
    "address": "123 Aquaculture Lane",
    "latitude": -1.2921,
    "longitude": 36.8219
  }')

echo $FARM_RESPONSE | jq .
FARM_ID=$(echo $FARM_RESPONSE | jq -r '.data.id')

# Test 5: Get Farms
echo -e "\n5. Listing Farms..."
curl -s "$BASE_URL/farms" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Test 6: Create Pond
if [ "$FARM_ID" != "null" ]; then
  echo -e "\n6. Creating Pond..."
  POND_RESPONSE=$(curl -s -X POST "$BASE_URL/ponds" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{
      \"farmId\": \"$FARM_ID\",
      \"name\": \"Pond A1\",
      \"code\": \"POND-A1\",
      \"pondType\": \"earthen\",
      \"waterSource\": \"borehole\",
      \"volumeLiters\": 500000,
      \"areaSqm\": 1000,
      \"fishSpecies\": \"Tilapia\"
    }")

  echo $POND_RESPONSE | jq .
  POND_ID=$(echo $POND_RESPONSE | jq -r '.data.id')

  # Test 7: Get Pond Status
  if [ "$POND_ID" != "null" ]; then
    echo -e "\n7. Getting Pond Status..."
    curl -s "$BASE_URL/ponds/$POND_ID/status" \
      -H "Authorization: Bearer $TOKEN" | jq .
  fi
fi

echo -e "\n================================"
echo "✅ API Tests Complete!"
echo "================================"
