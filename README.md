# 🐟 Aquaculture IoT Monitoring and Automation Platform

A complete hardware and software ecosystem for monitoring fish ponds, tanks, cages, and hatcheries. This platform enables fish farmers to monitor water-quality conditions in real-time, receive alerts, control equipment remotely, and automate feeding and water-circulation processes.

## 🏗️ Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   ESP32 IoT     │────▶│   MQTT Broker    │────▶│  Backend API    │
│   Controllers   │◀────│   (EMQX)         │◀────│  (Node.js)      │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                           ┌──────────────────┐           │
                           │  PostgreSQL +    │◀──────────┘
                           │  TimescaleDB     │
                           └──────────────────┘
                                  ▲
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
           ┌────────┴────┐ ┌──────┴──────┐ ┌────┴────────┐
           │  Customer   │ │   Admin     │ │   Mobile    │
           │  Web App    │ │   Portal    │ │   App       │
           │  (React)    │ │  (React)    │ │  (Flutter)  │
           └─────────────┘ └─────────────┘ └─────────────┘
```

## 📁 Project Structure

```
/
├── infrastructure/       # Docker environment (PostgreSQL, EMQX, Redis)
│   ├── docker-compose.yml
│   └── db/
│       └── init.sql      # Database schema with RLS multi-tenancy
├── backend/              # Node.js/Express API server
│   ├── src/
│   │   ├── index.js      # Main server entry point
│   │   ├── db/           # Database connection
│   │   ├── middleware/   # Auth & RBAC
│   │   ├── routes/       # API endpoints
│   │   │   ├── auth.js
│   │   │   ├── farms.js
│   │   │   └── ponds.js
│   │   └── services/     # Business logic
│   │       ├── authService.js
│   │       ├── farmService.js
│   │       ├── pondService.js
│   │       ├── deviceService.js
│   │       ├── telemetryService.js
│   │       ├── alertService.js
│   │       └── automationService.js
│   └── package.json
├── firmware/             # ESP32 controller code
│   └── src/
│       └── main.cpp
├── web-customer/         # React customer dashboard (TODO)
├── web-admin/            # React admin portal (TODO)
└── mobile-app/           # Flutter mobile app (TODO)
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- ESP32 development board (for hardware testing)

### 1. Start Infrastructure

```bash
cd infrastructure
docker-compose up -d
```

This starts:
- **PostgreSQL + TimescaleDB** on port 5432
- **EMQX MQTT Broker** on ports 1883 (MQTT), 18083 (WS), 8081 (Dashboard)
- **Redis** on port 6379

### 2. Start Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Server runs on `http://localhost:3000`

### 3. Test the API

#### Register a new organization and user
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@fishfarm.com",
    "password": "SecurePass123!",
    "organizationName": "My Fish Farm Ltd",
    "fullName": "Farm Administrator"
  }'
```

#### Login and get JWT token
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@fishfarm.com",
    "password": "SecurePass123!"
  }'
```

#### Create a farm
```bash
curl -X POST http://localhost:3000/api/farms \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Main Fish Farm",
    "code": "FARM-001",
    "address": "123 Lake Road, Aquaculture Valley",
    "latitude": -1.2921,
    "longitude": 36.8219,
    "managerName": "John Doe",
    "managerPhone": "+254700000000"
  }'
```

#### Create a pond
```bash
curl -X POST http://localhost:3000/api/ponds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "farmId": "FARM_UUID_HERE",
    "name": "Pond A1",
    "code": "POND-A1",
    "pondType": "earthen",
    "waterSource": "borehole",
    "volumeLiters": 500000,
    "areaSqm": 1000,
    "fishSpecies": "Tilapia"
  }'
```

## 🔧 Key Features Implemented

### ✅ Multi-Tenancy
- Row Level Security (RLS) in PostgreSQL ensures complete data isolation
- Each organization can only access their own farms, ponds, devices, and data
- Configurable via `app.current_org_id` database session variable

### ✅ Role-Based Access Control
- **OWNER**: Full organization access, billing, user management
- **MANAGER**: Farm and pond management, alert configuration
- **OPERATOR**: View-only access, manual readings, equipment control
- **TECHNICIAN**: Device installation, calibration, maintenance

### ✅ IoT Telemetry Pipeline
- MQTT-based communication with EMQX broker
- Automatic data ingestion into TimescaleDB hypertables
- Real-time alert generation based on configurable thresholds
- Automation rules engine for equipment control

### ✅ Database Schema
- Organizations, Users, Farms, Ponds, Devices
- Time-series sensor readings (optimized with TimescaleDB)
- Alerts with acknowledgment workflow
- Automation rules (trigger → action)
- Device command audit log

### ✅ ESP32 Firmware
- WiFi connectivity with auto-reconnect
- Sensor reading (temperature, pH, turbidity, water level)
- Relay control for pumps, aerators, feeders
- Offline buffering (stores 500+ readings locally)
- Local automation rules for safety during outages
- MQTT publish/subscribe for telemetry and commands

## 📡 MQTT Protocol

### Topics
```
aquaculture/{device_id}/telemetry          # Device → Cloud (sensor readings)
aquaculture/{device_id}/status             # Device → Cloud (health status)
aquaculture/{device_id}/command            # Cloud → Device (remote control)
aquaculture/{device_id}/command/response   # Device → Cloud (command result)
```

### Telemetry Payload
```json
{
  "deviceId": "DEV-001",
  "timestamp": "2024-01-15T10:30:00Z",
  "readings": {
    "temperature": 28.5,
    "ph": 7.2,
    "turbidity": 45.0,
    "waterLevel": 1.8
  },
  "deviceHealth": {
    "batteryLevel": 95.5,
    "signalStrength": -65,
    "uptime": 86400
  }
}
```

### Command Payload
```json
{
  "commandId": "CMD-123",
  "type": "relay_switch",
  "payload": {
    "relay": 1,
    "state": true,
    "durationMinutes": 30
  }
}
```

## 🛡️ Security

- JWT authentication with bcrypt password hashing
- Row Level Security (RLS) for data isolation
- Helmet security headers
- Rate limiting (100 requests per 15 minutes)
- CORS configuration
- Encrypted MQTT (TLS ready)
- Audit logging for all sensitive operations

## 📊 Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js + Express |
| Database | PostgreSQL + TimescaleDB |
| IoT Protocol | MQTT (EMQX Broker) |
| Cache/Queue | Redis |
| Frontend (Planned) | React + TypeScript |
| Mobile (Planned) | Flutter |
| Firmware | ESP32 + FreeRTOS |
| Infrastructure | Docker + Docker Compose |

## 🚧 Next Development Phases

### Phase 1 (Current - MVP)
- ✅ Core backend API
- ✅ Multi-tenant database schema
- ✅ MQTT telemetry ingestion
- ✅ Basic pond and farm management
- ⏳ Device registration endpoint
- ⏳ Alert notification service

### Phase 2 (Commercial Ready)
- [ ] React customer dashboard
- [ ] Flutter mobile app
- [ ] Subscription billing integration
- [ ] Advanced reporting (PDF/CSV exports)
- [ ] Email/SMS notifications
- [ ] Firmware OTA updates

### Phase 3 (Intelligence)
- [ ] Predictive analytics
- [ ] Fish growth modeling
- [ ] Feed optimization recommendations
- [ ] Equipment failure prediction
- [ ] Weather integration

## 📝 License

Proprietary - All rights reserved

## 🤝 Contributing

This is an internal project. Contact the product team for access.

---

**Built for sustainable aquaculture** 🐟💧🌱
