import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'dart:convert';

class LocalDbService {
  static Database? _database;
  static const String DB_NAME = 'aquaculture_local.db';
  static const int DB_VERSION = 1;

  static Future<void> init() async {
    if (_database != null) return;
    
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, DB_NAME);

    _database = await openDatabase(
      path,
      version: DB_VERSION,
      onCreate: _onCreate,
    );
  }

  static Future<void> _onCreate(Database db, int version) async {
    // Users table
    await db.execute('''
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        role TEXT,
        organization_id TEXT,
        created_at TEXT
      )
    ''');

    // Farms table
    await db.execute('''
      CREATE TABLE farms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT,
        address TEXT,
        latitude REAL,
        longitude REAL,
        manager_name TEXT,
        farm_type TEXT,
        organization_id TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    ''');

    // Ponds table
    await db.execute('''
      CREATE TABLE ponds (
        id TEXT PRIMARY KEY,
        farm_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT,
        pond_type TEXT,
        water_source TEXT,
        length_meters REAL,
        width_meters REAL,
        depth_meters REAL,
        volume_liters REAL,
        fish_species TEXT,
        stocking_date TEXT,
        fish_count INTEGER,
        growth_stage TEXT,
        target_harvest_date TEXT,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (farm_id) REFERENCES farms(id)
      )
    ''');

    // Devices table
    await db.execute('''
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        serial_number TEXT UNIQUE NOT NULL,
        model TEXT,
        firmware_version TEXT,
        pond_id TEXT,
        status TEXT,
        last_seen_at TEXT,
        battery_level INTEGER,
        signal_strength INTEGER,
        power_source TEXT,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (pond_id) REFERENCES ponds(id)
      )
    ''');

    // Sensor readings cache (for offline viewing)
    await db.execute('''
      CREATE TABLE sensor_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        sensor_type TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        timestamp TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        created_at TEXT
      )
    ''');

    // Alerts table
    await db.execute('''
      CREATE TABLE alerts (
        id TEXT PRIMARY KEY,
        pond_id TEXT NOT NULL,
        device_id TEXT,
        sensor_type TEXT,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        current_value REAL,
        expected_min REAL,
        expected_max REAL,
        message TEXT,
        status TEXT DEFAULT 'active',
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        resolved_by TEXT,
        resolved_at TEXT,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (pond_id) REFERENCES ponds(id)
      )
    ''');

    // Maintenance tasks
    await db.execute('''
      CREATE TABLE maintenance_tasks (
        id TEXT PRIMARY KEY,
        pond_id TEXT,
        device_id TEXT,
        task_type TEXT NOT NULL,
        description TEXT,
        scheduled_date TEXT NOT NULL,
        completed_date TEXT,
        status TEXT DEFAULT 'pending',
        assigned_to TEXT,
        notes TEXT,
        photos_json TEXT,
        parts_used_json TEXT,
        cost REAL,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (pond_id) REFERENCES ponds(id),
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )
    ''');

    // Queued API requests (for offline sync)
    await db.execute('''
      CREATE TABLE queued_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        data_json TEXT,
        created_at TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0
      )
    ''');

    // Cached API responses
    await db.execute('''
      CREATE TABLE cached_data (
        endpoint TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        cached_at TEXT NOT NULL,
        expires_at TEXT
      )
    ''');

    // Feeding records
    await db.execute('''
      CREATE TABLE feeding_records (
        id TEXT PRIMARY KEY,
        pond_id TEXT NOT NULL,
        feed_type TEXT,
        feed_supplier TEXT,
        pellet_size TEXT,
        quantity_grams REAL,
        feeding_time TEXT NOT NULL,
        duration_seconds INTEGER,
        feeder_id TEXT,
        status TEXT DEFAULT 'completed',
        notes TEXT,
        photos_json TEXT,
        created_by TEXT,
        created_at TEXT,
        synced INTEGER DEFAULT 0,
        FOREIGN KEY (pond_id) REFERENCES ponds(id)
      )
    ''');

    // Fish stock/batch records
    await db.execute('''
      CREATE TABLE fish_batches (
        id TEXT PRIMARY KEY,
        pond_id TEXT NOT NULL,
        species TEXT NOT NULL,
        batch_number TEXT,
        initial_count INTEGER,
        current_count INTEGER,
        avg_initial_weight_grams REAL,
        avg_current_weight_grams REAL,
        stocking_date TEXT NOT NULL,
        estimated_biomass_kg REAL,
        feed_conversion_ratio REAL,
        mortality_count INTEGER DEFAULT 0,
        harvest_date TEXT,
        status TEXT DEFAULT 'active',
        notes TEXT,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (pond_id) REFERENCES ponds(id)
      )
    ''');
  }

  static Database? get database => _database;

  // User operations
  static Future<void> saveUser(Map<String, dynamic> user) async {
    await _database!.insert(
      'users',
      user,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  static Future<Map<String, dynamic>?> getUser(String userId) async {
    final List<Map<String, dynamic>> maps = await _database!.query(
      'users',
      where: 'id = ?',
      whereArgs: [userId],
    );
    if (maps.isNotEmpty) {
      return maps.first;
    }
    return null;
  }

  // Farm operations
  static Future<void> saveFarm(Map<String, dynamic> farm) async {
    await _database!.insert(
      'farms',
      farm,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  static Future<List<Map<String, dynamic>>> getFarms() async {
    return await _database!.query('farms', orderBy: 'created_at DESC');
  }

  // Pond operations
  static Future<void> savePond(Map<String, dynamic> pond) async {
    await _database!.insert(
      'ponds',
      pond,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  static Future<List<Map<String, dynamic>>> getPonds(String farmId) async {
    return await _database!.query(
      'ponds',
      where: 'farm_id = ?',
      whereArgs: [farmId],
      orderBy: 'created_at DESC',
    );
  }

  // Device operations
  static Future<void> saveDevice(Map<String, dynamic> device) async {
    await _database!.insert(
      'devices',
      device,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // Sensor reading operations
  static Future<void> saveSensorReading(Map<String, dynamic> reading) async {
    await _database!.insert('sensor_readings', reading);
  }

  static Future<List<Map<String, dynamic>>> getRecentReadings(
    String deviceId, {
    int limit = 100,
  }) async {
    return await _database!.query(
      'sensor_readings',
      where: 'device_id = ?',
      whereArgs: [deviceId],
      orderBy: 'timestamp DESC',
      limit: limit,
    );
  }

  // Alert operations
  static Future<void> saveAlert(Map<String, dynamic> alert) async {
    await _database!.insert(
      'alerts',
      alert,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  static Future<List<Map<String, dynamic>>> getActiveAlerts() async {
    return await _database!.query(
      'alerts',
      where: 'status = ?',
      whereArgs: ['active'],
      orderBy: 'created_at DESC',
    );
  }

  static Future<void> updateAlertStatus(
    String alertId,
    String status,
    String? userId,
  ) async {
    final now = DateTime.now().toIso8601String();
    final field = status == 'acknowledged' ? 'acknowledged' : 'resolved';
    
    await _database!.update(
      'alerts',
      {
        'status': status,
        '${field}_by': userId,
        '${field}_at': now,
        'updated_at': now,
      },
      where: 'id = ?',
      whereArgs: [alertId],
    );
  }

  // Maintenance task operations
  static Future<void> saveMaintenanceTask(Map<String, dynamic> task) async {
    await _database!.insert(
      'maintenance_tasks',
      task,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  static Future<List<Map<String, dynamic>>> getMaintenanceTasks({
    String? status,
    String? pondId,
  }) async {
    String? where;
    List<dynamic>? whereArgs;

    if (status != null && pondId != null) {
      where = 'status = ? AND pond_id = ?';
      whereArgs = [status, pondId];
    } else if (status != null) {
      where = 'status = ?';
      whereArgs = [status];
    } else if (pondId != null) {
      where = 'pond_id = ?';
      whereArgs = [pondId];
    }

    return await _database!.query(
      'maintenance_tasks',
      where: where,
      whereArgs: whereArgs,
      orderBy: 'scheduled_date ASC',
    );
  }

  // Queued request operations
  static Future<void> queueRequest(
    String method,
    String endpoint,
    Map<String, dynamic> data,
  ) async {
    await _database!.insert('queued_requests', {
      'method': method,
      'endpoint': endpoint,
      'data_json': json.encode(data),
      'created_at': DateTime.now().toIso8601String(),
      'retry_count': 0,
    });
  }

  static Future<List<Map<String, dynamic>>> getQueuedRequests() async {
    return await _database!.query(
      'queued_requests',
      orderBy: 'created_at ASC',
    );
  }

  static Future<void> removeQueuedRequest(int id) async {
    await _database!.delete(
      'queued_requests',
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  // Cache operations
  static Future<void> cacheData(String endpoint, Map<String, dynamic> data) async {
    final now = DateTime.now();
    final expiresAt = now.add(const Duration(hours: 1));

    await _database!.insert(
      'cached_data',
      {
        'endpoint': endpoint,
        'data_json': json.encode(data),
        'cached_at': now.toIso8601String(),
        'expires_at': expiresAt.toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  static Future<Map<String, dynamic>> getCachedData(String endpoint) async {
    final List<Map<String, dynamic>> maps = await _database!.query(
      'cached_data',
      where: 'endpoint = ? AND expires_at > ?',
      whereArgs: [endpoint, DateTime.now().toIso8601String()],
    );

    if (maps.isNotEmpty) {
      return json.decode(maps.first['data_json'] as String);
    }

    throw Exception('No valid cache found');
  }

  // Feeding record operations
  static Future<void> saveFeedingRecord(Map<String, dynamic> record) async {
    await _database!.insert('feeding_records', record);
  }

  static Future<List<Map<String, dynamic>>> getFeedingRecords(String pondId, {
    DateTime? startDate,
    DateTime? endDate,
  }) async {
    String? where = 'pond_id = ?';
    List<dynamic> whereArgs = [pondId];

    if (startDate != null) {
      where += ' AND feeding_time >= ?';
      whereArgs.add(startDate.toIso8601String());
    }

    if (endDate != null) {
      where += ' AND feeding_time <= ?';
      whereArgs.add(endDate.toIso8601String());
    }

    return await _database!.query(
      'feeding_records',
      where: where,
      whereArgs: whereArgs,
      orderBy: 'feeding_time DESC',
    );
  }

  // Fish batch operations
  static Future<void> saveFishBatch(Map<String, dynamic> batch) async {
    await _database!.insert(
      'fish_batches',
      batch,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  static Future<List<Map<String, dynamic>>> getFishBatches(String pondId) async {
    return await _database!.query(
      'fish_batches',
      where: 'pond_id = ?',
      whereArgs: [pondId],
      orderBy: 'stocking_date DESC',
    );
  }

  // Utility: Clear all data (for logout)
  static Future<void> clearAllData() async {
    final tables = [
      'users',
      'farms',
      'ponds',
      'devices',
      'sensor_readings',
      'alerts',
      'maintenance_tasks',
      'queued_requests',
      'cached_data',
      'feeding_records',
      'fish_batches',
    ];

    for (var table in tables) {
      await _database!.delete(table);
    }
  }

  // Utility: Get unsynced feeding records
  static Future<List<Map<String, dynamic>>> getUnsyncedFeedingRecords() async {
    return await _database!.query(
      'feeding_records',
      where: 'synced = 0',
      orderBy: 'created_at ASC',
    );
  }

  // Utility: Mark feeding record as synced
  static Future<void> markFeedingRecordSynced(String recordId) async {
    await _database!.update(
      'feeding_records',
      {'synced': 1},
      where: 'id = ?',
      whereArgs: [recordId],
    );
  }
}
