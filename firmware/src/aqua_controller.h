#ifndef AQUA_CONTROLLER_H
#define AQUA_CONTROLLER_H

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <SPIFFS.h>
#include <RTClib.h>

// ======================
// Configuration
// ======================
#define DEVICE_MODEL "AQUA-CTRL-V1"
#define FIRMWARE_VERSION "1.0.0"

// Pin definitions (adjust based on your hardware)
#define SENSOR_TEMP_PIN 34
#define SENSOR_PH_PIN 35
#define SENSOR_TURBIDITY_PIN 32
#define SENSOR_WATER_LEVEL_PIN 33

// Relay pins for equipment control
#define RELAY_PUMP_1 26
#define RELAY_PUMP_2 27
#define RELAY_AERATOR_1 14
#define RELAY_AERATOR_2 12
#define RELAY_FEEDER 13

// Status LED
#define STATUS_LED_PIN 2

// ======================
// Global Objects
// ======================
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
RTC_DS3231 rtc;

// ======================
// Configuration Structure
// ======================
struct DeviceConfig {
  char deviceId[50];
  char mqttBroker[100];
  int mqttPort;
  char mqttUsername[50];
  char mqttPassword[50];
  char wifiSSID[50];
  char wifiPassword[50];
  int telemetryInterval; // seconds
};

DeviceConfig config;

// ======================
// State Variables
// ======================
bool isWifiConnected = false;
bool isMqttConnected = false;
unsigned long lastTelemetryTime = 0;
unsigned long lastReconnectAttempt = 0;
int reconnectAttempts = 0;

// Offline storage
#define MAX_BUFFERED_READINGS 500
struct BufferedReading {
  char timestamp[30];
  char sensorType[20];
  float value;
  char unit[10];
};

BufferedReading offlineBuffer[MAX_BUFFERED_READINGS];
int bufferIndex = 0;

// Equipment state
struct EquipmentState {
  bool pump1;
  bool pump2;
  bool aerator1;
  bool aerator2;
  bool feeder;
};

EquipmentState equipment;

// ======================
// Function Declarations
// ======================
void initWiFi();
void initMQTT();
void connectToWiFi();
void connectToMQTT();
void readSensors();
float readTemperature();
float readPH();
float readTurbidity();
float readWaterLevel();
void publishTelemetry();
void publishBufferedReadings();
void storeReadingOffline(const char* timestamp, const char* type, float value, const char* unit);
void callback(char* topic, byte* payload, unsigned int length);
void processCommand(String command, JsonObject params);
void controlRelay(int relayPin, bool state);
void saveConfig();
void loadConfig();
void blinkLED(int times, int interval);
String getTimestamp();
void checkAutomationRules();

#endif
