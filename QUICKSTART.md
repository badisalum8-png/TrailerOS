# 🚀 Aquaculture IoT Platform - Quick Start Guide

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- ESP32 device (optional, for hardware testing)

## 1. Start Infrastructure

```bash
cd /workspace/infrastructure
docker-compose up -d
```

This starts:
- **PostgreSQL + TimescaleDB** (port 5432) - Main database with time-series support
- **EMQX MQTT Broker** (port 1883, 18083) - IoT communication
- **Redis** (port 6379) - Caching and queues

Verify services are running:
```bash
docker-compose ps
```

## 2. Initialize Database

The database initializes automatically on first run. Check logs:
```bash
docker-compose logs db | grep "database system is ready"
```

## 3. Start Backend API

```bash
cd /workspace/backend
npm install
cp .env.example .env
npm run dev
```

Server starts on `http://localhost:3000`

Check health:
```bash
curl http://localhost:3000/health
```

## 4. Test the API

### Option A: Using the test script
```bash
cd /workspace/backend
./test/api-test.sh
```

### Option B: Manual testing

**Register new organization:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@fishfarm.com",
    "password": "SecurePass123!",
    "organizationName": "My Fish Farm"
  }'
```

Save the token from response, then:

**Create a farm:**
```bash
curl -X POST http://localhost:3000/api/farms \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Main Farm",
    "code": "FARM-001",
    "address": "Nairobi, Kenya",
    "latitude": -1.2921,
    "longitude": 36.8219
  }'
```

**Create a pond:**
```bash
curl -X POST http://localhost:3000/api/ponds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "farmId": "FARM_ID_FROM_ABOVE",
    "name": "Pond A1",
    "pondType": "earthen",
    "fishSpecies": "Tilapia"
  }'
```

## 5. Simulate IoT Device (Optional)

Install MQTT CLI:
```bash
npm install -g mqtt-cli
```

Publish sensor data:
```bash
mqtt pub -t 'aquaculture/DEVICE_ID/telemetry' \
  -h 'localhost' \
  -m '{
    "timestamp": "2024-01-20T10:30:00Z",
    "readings": [
      {"sensorType": "temperature", "value": 28.5, "unit": "celsius"},
      {"sensorType": "ph", "value": 7.2, "unit": "pH"},
      {"sensorType": "turbidity", "value": 45.3, "unit": "NTU"}
    ],
    "deviceHealth": {
      "batteryVoltage": 12.6,
      "signalStrength": -67
    }
  }'
```

View in database:
```bash
docker-compose exec db psql -U aqua_user -d aquaculture_db \
  -c "SELECT * FROM sensor_readings ORDER BY time DESC LIMIT 10;"
```

## 6. Access MQTT Dashboard

Open browser: `http://localhost:18083`
- Username: `admin`
- Password: `public` (change in production!)

## Project Structure

```
/workspace/
├── infrastructure/       # Docker services
│   ├── docker-compose.yml
│   └── db/init.sql      # Database schema
├── backend/
│   ├── src/
│   │   ├── index.js     # Main server
│   │   ├── routes/      # API endpoints
│   │   └── services/    # Business logic
│   └── test/
│       └── api-test.sh  # Test script
├── firmware/            # ESP32 code
├── web-customer/        # React dashboard (TODO)
├── web-admin/           # Admin portal (TODO)
└── mobile-app/          # Flutter app (TODO)
```

## Common Commands

**View logs:**
```bash
docker-compose logs -f        # All services
docker-compose logs -f db     # Database only
docker-compose logs -f mqtt   # MQTT broker only
```

**Restart services:**
```bash
docker-compose restart
```

**Reset database:**
```bash
docker-compose down -v
docker-compose up -d db
```

**Stop everything:**
```bash
docker-compose down
```

## Next Steps

1. **Build Frontend**: Create React dashboard in `web-customer/`
2. **Mobile App**: Develop Flutter app in `mobile-app/`
3. **Hardware**: Flash firmware to ESP32
4. **Notifications**: Add email/SMS integration
5. **Reports**: Implement PDF/CSV export

## Documentation

- [API Documentation](./API_DOCUMENTATION.md)
- [Architecture Overview](./README.md)
- [Database Schema](./infrastructure/db/init.sql)

## Troubleshooting

**Port already in use:**
```bash
lsof -i :3000  # Find process
kill -9 <PID>  # Kill it
```

**Database connection failed:**
```bash
docker-compose logs db  # Check DB logs
```

**MQTT connection failed:**
```bash
docker-compose logs mqtt  # Check broker logs
```

---

🎉 You're ready to build your Aquaculture IoT Platform!
