#include "aqua_controller.h"

// ======================
// WiFi Configuration
// ======================
void initWiFi() {
  Serial.println("Initializing WiFi...");
  WiFi.begin(config.wifiSSID, config.wifiPassword);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    isWifiConnected = true;
    Serial.println("\nWiFi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    blinkLED(2, 200);
  } else {
    isWifiConnected = false;
    Serial.println("\nWiFi connection failed!");
    blinkLED(5, 100);
  }
}

void connectToWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Reconnecting to WiFi...");
    initWiFi();
  }
}

// ======================
// MQTT Configuration
// ======================
void initMQTT() {
  mqttClient.setServer(config.mqttBroker, config.mqttPort);
  mqttClient.setCallback(callback);
  
  Serial.print("Connecting to MQTT broker: ");
  Serial.println(config.mqttBroker);
  
  connectToMQTT();
}

void connectToMQTT() {
  if (!mqttClient.connected()) {
    String clientId = String("AQUA_") + String(config.deviceId);
    
    if (mqttClient.connect(clientId.c_str(), config.mqttUsername, config.mqttPassword)) {
      isMqttConnected = true;
      Serial.println("MQTT connected!");
      
      // Subscribe to command topic
      String commandTopic = String("aquaculture/") + String(config.deviceId) + "/command";
      mqttClient.subscribe(commandTopic.c_str());
      Serial.print("Subscribed to: ");
      Serial.println(commandTopic);
      
      // Publish device status
      publishDeviceStatus();
      
      reconnectAttempts = 0;
    } else {
      isMqttConnected = false;
      Serial.print("MQTT connection failed, rc=");
      Serial.println(mqttClient.state());
      reconnectAttempts++;
    }
  }
}

void publishDeviceStatus() {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = config.deviceId;
  doc["status"] = isWifiConnected ? "ONLINE" : "OFFLINE";
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  doc["timestamp"] = getTimestamp();
  doc["wifiRSSI"] = WiFi.RSSI();
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String statusTopic = String("aquaculture/") + String(config.deviceId) + "/status";
  mqttClient.publish(statusTopic.c_str(), buffer);
}

// ======================
// Sensor Reading Functions
// ======================
float readTemperature() {
  // Placeholder: Replace with actual sensor reading logic
  // Example for DS18B20 or analog temperature sensor
  int raw = analogRead(SENSOR_TEMP_PIN);
  float voltage = raw * (3.3 / 4095.0);
  float temperature = (voltage - 0.5) * 100.0; // LM35 example
  return temperature;
}

float readPH() {
  // Placeholder: Replace with actual pH sensor logic
  int raw = analogRead(SENSOR_PH_PIN);
  float voltage = raw * (3.3 / 4095.0);
  // pH calibration formula depends on your sensor
  float ph = 7.0 + (voltage - 1.65) * 2.0; 
  return constrain(ph, 0.0, 14.0);
}

float readTurbidity() {
  // Placeholder: Replace with actual turbidity sensor logic
  int raw = analogRead(SENSOR_TURBIDITY_PIN);
  float voltage = raw * (3.3 / 4095.0);
  // Convert to NTU based on sensor calibration
  float ntus = voltage * 1000.0; 
  return constrain(ntus, 0.0, 5000.0);
}

float readWaterLevel() {
  // Placeholder: Replace with actual water level sensor logic
  int raw = analogRead(SENSOR_WATER_LEVEL_PIN);
  // Convert to cm based on sensor calibration
  float level = raw * 0.1; 
  return constrain(level, 0.0, 500.0);
}

void readSensors() {
  String timestamp = getTimestamp();
  
  // Read all sensors
  float temp = readTemperature();
  float ph = readPH();
  float turbidity = readTurbidity();
  float waterLevel = readWaterLevel();
  
  // Store readings (publish or buffer)
  if (isMqttConnected) {
    storeReadingOffline(timestamp.c_str(), "temperature", temp, "C");
    storeReadingOffline(timestamp.c_str(), "ph", ph, "pH");
    storeReadingOffline(timestamp.c_str(), "turbidity", turbidity, "NTU");
    storeReadingOffline(timestamp.c_str(), "water_level", waterLevel, "cm");
  } else {
    storeReadingOffline(timestamp.c_str(), "temperature", temp, "C");
    storeReadingOffline(timestamp.c_str(), "ph", ph, "pH");
    storeReadingOffline(timestamp.c_str(), "turbidity", turbidity, "NTU");
    storeReadingOffline(timestamp.c_str(), "water_level", waterLevel, "cm");
  }
  
  // Check automation rules locally
  checkAutomationRules();
}

// ======================
// Telemetry Publishing
// ======================
void publishTelemetry() {
  if (!isMqttConnected) {
    Serial.println("Cannot publish telemetry: MQTT not connected");
    return;
  }
  
  StaticJsonDocument<1024> doc;
  doc["deviceId"] = config.deviceId;
  doc["timestamp"] = getTimestamp();
  doc["battery"] = 85.0; // Placeholder: read actual battery voltage
  doc["signal"] = WiFi.RSSI();
  
  JsonArray readings = doc.createNestedArray("readings");
  
  // Add buffered readings
  for (int i = 0; i < bufferIndex; i++) {
    JsonObject reading = readings.createNestedObject();
    reading["timestamp"] = offlineBuffer[i].timestamp;
    reading["type"] = offlineBuffer[i].sensorType;
    reading["value"] = offlineBuffer[i].value;
    reading["unit"] = offlineBuffer[i].unit;
  }
  
  char buffer[2048];
  serializeJson(doc, buffer);
  
  String telemetryTopic = String("aquaculture/") + String(config.deviceId) + "/telemetry";
  
  if (mqttClient.publish(telemetryTopic.c_str(), buffer)) {
    Serial.println("Telemetry published successfully");
    bufferIndex = 0; // Clear buffer after successful publish
  } else {
    Serial.println("Failed to publish telemetry");
  }
}

void storeReadingOffline(const char* timestamp, const char* type, float value, const char* unit) {
  if (bufferIndex < MAX_BUFFERED_READINGS) {
    strncpy(offlineBuffer[bufferIndex].timestamp, timestamp, 29);
    strncpy(offlineBuffer[bufferIndex].sensorType, type, 19);
    offlineBuffer[bufferIndex].value = value;
    strncpy(offlineBuffer[bufferIndex].unit, unit, 9);
    bufferIndex++;
  } else {
    Serial.println("Offline buffer full! Oldest readings will be lost.");
  }
}

void publishBufferedReadings() {
  if (isMqttConnected && bufferIndex > 0) {
    Serial.print("Publishing ");
    Serial.print(bufferIndex);
    Serial.println(" buffered readings...");
    publishTelemetry();
  }
}

// ======================
// Command Handling
// ======================
void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  
  char message[length + 1];
  for (unsigned int i = 0; i < length; i++) {
    message[i] = (char)payload[i];
  }
  message[length] = '\0';
  
  Serial.println(message);
  
  // Parse JSON
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.print("JSON parse failed: ");
    Serial.println(error.f_str());
    return;
  }
  
  String command = doc["command"].as<String>();
  JsonObject params = doc["params"];
  int commandId = doc["commandId"];
  
  processCommand(command, params);
  
  // Send response
  sendCommandResponse(commandId, command, "SUCCESS", "Command executed");
}

void processCommand(String command, JsonObject params) {
  Serial.print("Processing command: ");
  Serial.println(command);
  
  if (command == "START_PUMP") {
    controlRelay(RELAY_PUMP_1, HIGH);
  } else if (command == "STOP_PUMP") {
    controlRelay(RELAY_PUMP_1, LOW);
  } else if (command == "START_AERATOR") {
    controlRelay(RELAY_AERATOR_1, HIGH);
  } else if (command == "STOP_AERATOR") {
    controlRelay(RELAY_AERATOR_1, LOW);
  } else if (command == "TRIGGER_FEEDER") {
    controlRelay(RELAY_FEEDER, HIGH);
    delay(5000); // Run feeder for 5 seconds
    controlRelay(RELAY_FEEDER, LOW);
  } else if (command == "RESTART") {
    ESP.restart();
  } else {
    Serial.println("Unknown command");
  }
}

void sendCommandResponse(int commandId, String command, String status, String message) {
  StaticJsonDocument<256> doc;
  doc["commandId"] = commandId;
  doc["command"] = command;
  doc["status"] = status;
  doc["message"] = message;
  doc["timestamp"] = getTimestamp();
  
  char buffer[512];
  serializeJson(doc, buffer);
  
  String responseTopic = String("aquaculture/") + String(config.deviceId) + "/command/response";
  mqttClient.publish(responseTopic.c_str(), buffer);
}

// ======================
// Equipment Control
// ======================
void controlRelay(int relayPin, bool state) {
  digitalWrite(relayPin, state);
  Serial.print("Relay ");
  Serial.print(relayPin);
  Serial.print(" set to ");
  Serial.println(state ? "HIGH" : "LOW");
}

void checkAutomationRules() {
  // Local automation rules for offline operation
  // Example: Turn on aerator if dissolved oxygen is low
  
  float temp = readTemperature();
  float ph = readPH();
  
  // Safety rule: Stop pump if water level too low
  float waterLevel = readWaterLevel();
  if (waterLevel < 10.0) { // Below 10cm
    controlRelay(RELAY_PUMP_1, LOW);
    Serial.println("AUTO: Water level too low, pump stopped");
  }
  
  // Add more automation rules as needed
}

// ======================
// Utility Functions
// ======================
String getTimestamp() {
  if (rtc.begin()) {
    DateTime now = rtc.now();
    char buffer[30];
    sprintf(buffer, "%04d-%02d-%02dT%02d:%02d:%02dZ",
            now.year(), now.month(), now.day(),
            now.hour(), now.minute(), now.second());
    return String(buffer);
  } else {
    // Fallback to uptime-based timestamp
    unsigned long secs = millis() / 1000;
    return String(secs);
  }
}

void blinkLED(int times, int interval) {
  for (int i = 0; i < times; i++) {
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(interval);
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(interval);
  }
}

void loadConfig() {
  // Load configuration from SPIFFS or EEPROM
  // This is a placeholder - implement based on your storage method
  strcpy(config.deviceId, "DEVICE-001");
  strcpy(config.mqttBroker, "broker.aquaculture.io");
  config.mqttPort = 1883;
  strcpy(config.mqttUsername, "device_user");
  strcpy(config.mqttPassword, "device_pass");
  strcpy(config.wifiSSID, "FarmWiFi");
  strcpy(config.wifiPassword, "wifi_password");
  config.telemetryInterval = 60; // 60 seconds
}

void saveConfig() {
  // Save configuration to SPIFFS or EEPROM
  Serial.println("Configuration saved");
}

// ======================
// Setup and Loop
// ======================
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n=== Aquaculture IoT Controller ===");
  Serial.print("Firmware Version: ");
  Serial.println(FIRMWARE_VERSION);
  
  // Initialize pins
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(RELAY_PUMP_1, OUTPUT);
  pinMode(RELAY_PUMP_2, OUTPUT);
  pinMode(RELAY_AERATOR_1, OUTPUT);
  pinMode(RELAY_AERATOR_2, OUTPUT);
  pinMode(RELAY_FEEDER, OUTPUT);
  
  // Initialize SPIFFS for offline storage
  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS initialization failed!");
  }
  
  // Initialize RTC
  if (!rtc.begin()) {
    Serial.println("RTC initialization failed!");
  }
  
  // Load configuration
  loadConfig();
  
  // Initialize WiFi
  initWiFi();
  
  // Initialize MQTT
  initMQTT();
  
  blinkLED(3, 300);
  Serial.println("Setup complete!");
}

void loop() {
  // Maintain MQTT connection
  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastReconnectAttempt > 5000) {
      lastReconnectAttempt = now;
      connectToWiFi();
      connectToMQTT();
    }
  }
  
  mqttClient.loop();
  
  // Read sensors at configured interval
  unsigned long now = millis();
  if (now - lastTelemetryTime >= (config.telemetryInterval * 1000)) {
    lastTelemetryTime = now;
    readSensors();
    
    if (isMqttConnected) {
      publishTelemetry();
    }
  }
  
  // Small delay to prevent watchdog reset
  delay(100);
}
