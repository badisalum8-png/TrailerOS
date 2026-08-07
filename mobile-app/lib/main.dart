import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'screens/farm_list_screen.dart';
import 'screens/pond_detail_screen.dart';
import 'screens/alerts_screen.dart';
import 'screens/device_provisioning_screen.dart';
import 'screens/maintenance_screen.dart';
import 'services/auth_service.dart';
import 'services/api_service.dart';
import 'services/mqtt_service.dart';
import 'services/local_db_service.dart';
import 'providers/auth_provider.dart';
import 'providers/farm_provider.dart';
import 'providers/alert_provider.dart';
import 'providers/device_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize services
  await LocalDbService.init();
  await ApiService.init();
  await MqttService.init();
  
  runApp(const AquacultureApp());
}

class AquacultureApp extends StatelessWidget {
  const AquacultureApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => FarmProvider()),
        ChangeNotifierProvider(create: (_) => AlertProvider()),
        ChangeNotifierProvider(create: (_) => DeviceProvider()),
      ],
      child: MaterialApp(
        title: 'AquaFarm Monitor',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF0077BE),
            brightness: Brightness.light,
          ),
          useMaterial3: true,
          appBarTheme: const AppBarTheme(
            centerTitle: true,
            elevation: 0,
          ),
          cardTheme: CardTheme(
            elevation: 2,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          inputDecorationTheme: InputDecorationTheme(
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 12,
            ),
          ),
        ),
        darkTheme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF0077BE),
            brightness: Brightness.dark,
          ),
          useMaterial3: true,
        ),
        themeMode: ThemeMode.system,
        home: const LoginScreen(),
        routes: {
          '/login': (context) => const LoginScreen(),
          '/home': (context) => const HomeScreen(),
          '/farms': (context) => const FarmListScreen(),
          '/alerts': (context) => const AlertsScreen(),
          '/provision': (context) => const DeviceProvisioningScreen(),
          '/maintenance': (context) => const MaintenanceScreen(),
          '/pond/:id': (context) => PondDetailScreen(
                pondId: ModalRoute.of(context)!.settings.arguments as String,
              ),
        },
      ),
    );
  }
}
