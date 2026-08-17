import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'local_db_service.dart';

class ApiService {
  static String? _baseUrl;
  static final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();
  static bool _isInitialized = false;

  static Future<void> init() async {
    if (_isInitialized) return;
    
    // In production, this would come from config or environment
    _baseUrl = 'https://api.aquaculture-platform.com';
    _isInitialized = true;
  }

  static String? get baseUrl => _baseUrl;

  static Future<String?> getToken() async {
    return await _secureStorage.read(key: 'auth_token');
  }

  static Future<void> saveToken(String token) async {
    await _secureStorage.write(key: 'auth_token', value: token);
  }

  static Future<void> clearToken() async {
    await _secureStorage.delete(key: 'auth_token');
  }

  static Future<bool> isConnected() async {
    final connectivityResult = await Connectivity().checkConnectivity();
    return !connectivityResult.contains(ConnectivityResult.none);
  }

  static Future<Map<String, dynamic>> get(String endpoint) async {
    final token = await getToken();
    final connected = await isConnected();

    if (!connected) {
      // Try to get from local cache
      return await LocalDbService.getCachedData(endpoint);
    }

    final response = await http.get(
      Uri.parse('$_baseUrl$endpoint'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );

    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      // Cache the data locally
      await LocalDbService.cacheData(endpoint, data);
      return data;
    } else {
      throw Exception('Failed to load data: ${response.statusCode}');
    }
  }

  static Future<Map<String, dynamic>> post(String endpoint, Map<String, dynamic> data) async {
    final token = await getToken();
    final connected = await isConnected();

    if (!connected) {
      // Queue request for later sync
      await LocalDbService.queueRequest('POST', endpoint, data);
      throw Exception('No internet connection. Request queued for sync.');
    }

    final response = await http.post(
      Uri.parse('$_baseUrl$endpoint'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode(data),
    );

    if (response.statusCode == 200 || response.statusCode == 201) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to post data: ${response.statusCode}');
    }
  }

  static Future<Map<String, dynamic>> put(String endpoint, Map<String, dynamic> data) async {
    final token = await getToken();
    final connected = await isConnected();

    if (!connected) {
      await LocalDbService.queueRequest('PUT', endpoint, data);
      throw Exception('No internet connection. Request queued for sync.');
    }

    final response = await http.put(
      Uri.parse('$_baseUrl$endpoint'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode(data),
    );

    if (response.statusCode == 200) {
      return json.decode(response.body);
    } else {
      throw Exception('Failed to update data: ${response.statusCode}');
    }
  }

  static Future<void> delete(String endpoint) async {
    final token = await getToken();
    final connected = await isConnected();

    if (!connected) {
      await LocalDbService.queueRequest('DELETE', endpoint, {});
      throw Exception('No internet connection. Request queued for sync.');
    }

    final response = await http.delete(
      Uri.parse('$_baseUrl$endpoint'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );

    if (response.statusCode != 200 && response.statusCode != 204) {
      throw Exception('Failed to delete data: ${response.statusCode}');
    }
  }

  // Sync queued requests when connection is restored
  static Future<void> syncQueuedRequests() async {
    final queuedRequests = await LocalDbService.getQueuedRequests();
    
    for (var request in queuedRequests) {
      try {
        switch (request['method']) {
          case 'POST':
            await post(request['endpoint'], request['data']);
            break;
          case 'PUT':
            await put(request['endpoint'], request['data']);
            break;
          case 'DELETE':
            await delete(request['endpoint']);
            break;
        }
        // Remove from queue after successful sync
        await LocalDbService.removeQueuedRequest(request['id']);
      } catch (e) {
        // Keep failed requests in queue for retry
        print('Sync failed for request ${request['id']}: $e');
      }
    }
  }
}
