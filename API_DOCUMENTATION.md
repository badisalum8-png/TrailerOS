# 🐟 Aquaculture IoT Platform - API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication

All authenticated endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

---

## 🔐 Authentication Endpoints

### POST /auth/register
Register a new organization and owner account.

**Request:**
```json
{
  "email": "admin@fishfarm.com",
  "password": "SecurePass123!",
  "organizationName": "My Fish Farm Ltd"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "uuid",
      "email": "admin@fishfarm.com",
      "role": "OWNER",
      "organizationId": "uuid"
    }
  }
}
```

### POST /auth/login
Login with existing credentials.

**Request:**
```json
{
  "email": "admin@fishfarm.com",
  "password": "SecurePass123!"
}
```

### GET /auth/me
Get current user profile.

**Headers:** `Authorization: Bearer <token>`

---

## 🏡 Farm Management

### POST /farms
Create a new farm.

**Request:**
```json
{
  "name": "Main Fish Farm",
  "code": "FARM-001",
  "address": "123 Aquaculture Lane",
  "latitude": -1.2921,
  "longitude": 36.8219
}
```

### GET /farms
List all farms for the organization.

### GET /farms/:id
Get specific farm details.

### PUT /farms/:id
Update farm information.

### DELETE /farms/:id
Delete a farm (must have no ponds).

---

## 🌊 Pond Management

### POST /ponds
Create a new pond.

**Request:**
```json
{
  "farmId": "uuid",
  "name": "Pond A1",
  "code": "POND-A1",
  "pondType": "earthen",
  "waterSource": "borehole",
  "volumeLiters": 500000,
  "areaSqm": 1000,
  "fishSpecies": "Tilapia",
  "stockingDate": "2024-01-15"
}
```

### GET /ponds?farmId=xxx
List all ponds for a farm.

### GET /ponds/:id
Get pond details.

### GET /ponds/:id/status
Get pond status with latest sensor readings.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Pond A1",
    "device_status": "online",
    "battery_level": 85,
    "signal_strength": -67,
    "readings": {
      "temperature": 28.5,
      "ph": 7.2,
      "turbidity": 45.3,
      "waterLevel": 1.8
    }
  }
}
```

### GET /ponds/:id/history
Get historical sensor data.

**Query Parameters:**
- `sensorType` (required): temperature, ph, turbidity, waterLevel
- `startTime`: ISO 8601 date
- `endTime`: ISO 8601 date

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "time_period": "2024-01-20T10:00:00Z",
      "sensor_type": "temperature",
      "avg_value": 28.3,
      "min_value": 27.8,
      "max_value": 29.1
    }
  ]
}
```

### PUT /ponds/:id
Update pond details.

### DELETE /ponds/:id
Delete a pond (must have no devices).

---

## 📱 Device Management

### POST /devices/register
Register a new device using serial number.

**Request:**
```json
{
  "serialNumber": "SN-2024-001234",
  "modelNumber": "AQUA-CONTROLLER-V1",
  "pondId": "uuid",
  "name": "Pond A1 Controller",
  "location": "North Bank"
}
```

### GET /devices?status=online
List devices with optional filters.

**Query Parameters:**
- `status`: online, offline, maintenance, error
- `farmId`: filter by farm

### GET /devices/:id
Get device details.

### PUT /devices/:id/activate
Activate a device after installation.

**Request:**
```json
{
  "pondId": "uuid",
  "calibrationData": {
    "temperature": { "offset": 0.5, "factor": 1.0 },
    "ph": { "offset": -0.1, "factor": 1.0 }
  },
  "technicianNotes": "Installed on concrete platform"
}
```

### PUT /devices/:id/status
Update device status (used by firmware).

**Request:**
```json
{
  "status": "online",
  "lastSeenAt": "2024-01-20T10:30:00Z",
  "batteryLevel": 85,
  "signalStrength": -67,
  "firmwareVersion": "1.2.3"
}
```

### GET /devices/:id/telemetry
Get device telemetry summary.

**Query Parameters:**
- `hours`: number (default: 24)

---

## 📊 Telemetry & Alerts

### MQTT Topics

**Device publishes to:**
```
aquaculture/{deviceId}/telemetry
aquaculture/{deviceId}/status
aquaculture/{deviceId}/response
```

**Cloud publishes to:**
```
aquaculture/{deviceId}/command
aquaculture/{deviceId}/config
```

### Telemetry Payload
```json
{
  "timestamp": "2024-01-20T10:30:00Z",
  "readings": [
    { "sensorType": "temperature", "value": 28.5, "unit": "celsius" },
    { "sensorType": "ph", "value": 7.2, "unit": "pH" },
    { "sensorType": "turbidity", "value": 45.3, "unit": "NTU" },
    { "sensorType": "waterLevel", "value": 1.8, "unit": "meters" }
  ],
  "deviceHealth": {
    "batteryVoltage": 12.6,
    "signalStrength": -67,
    "memoryFree": 45000
  }
}
```

### Command Payload
```json
{
  "commandId": "uuid",
  "action": "relay_control",
  "params": {
    "relayId": 1,
    "state": true,
    "duration": 3600
  },
  "expiresAt": "2024-01-20T11:00:00Z"
}
```

---

## 🚨 Alert System

Alerts are automatically generated when:
- Sensor readings exceed configured thresholds
- Device goes offline
- Battery level is low
- Automation rules trigger

### GET /alerts
List active alerts.

**Query Parameters:**
- `status`: active, acknowledged, resolved
- `severity`: critical, warning, info
- `pondId`: filter by pond

### PUT /alerts/:id/acknowledge
Acknowledge an alert.

### PUT /alerts/:id/resolve
Resolve an alert.

---

## ⚙️ Automation Rules

### POST /automation/rules
Create automation rule.

**Request:**
```json
{
  "name": "Low Oxygen Aeration",
  "pondId": "uuid",
  "trigger": {
    "sensorType": "dissolvedOxygen",
    "operator": "lt",
    "threshold": 4.0
  },
  "action": {
    "type": "relay_control",
    "relayId": 1,
    "state": true
  },
  "resetCondition": {
    "sensorType": "dissolvedOxygen",
    "operator": "gte",
    "threshold": 5.0
  },
  "resetAction": {
    "type": "relay_control",
    "relayId": 1,
    "state": false
  },
  "offlineEnabled": true
}
```

### GET /automation/rules
List all automation rules.

### PUT /automation/rules/:id
Update rule.

### DELETE /automation/rules/:id
Delete rule.

---

## 📈 Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing or invalid token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 500 | Internal Server Error |

---

## 🧪 Testing

Run the test script:
```bash
cd backend
./test/api-test.sh
```

Requires:
- Backend running on port 3000
- `jq` installed (`apt install jq`)
- `curl` installed

---

## 📝 Notes

- All timestamps are in ISO 8601 format
- UUIDs are used for all resource IDs
- Multi-tenancy is enforced at database level via RLS
- Rate limiting: 100 requests per 15 minutes per IP
- Session timeout: 24 hours
