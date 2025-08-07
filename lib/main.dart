import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'providers/auth_provider.dart';
import 'providers/device_provider.dart';
import 'providers/mqtt_provider.dart';
import 'screens/splash_screen.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'utils/theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Load environment variables
  await dotenv.load(fileName: ".env");

  runApp(const SolarControllerApp());
}

class SolarControllerApp extends StatelessWidget {
  const SolarControllerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProxyProvider<AuthProvider, DeviceProvider>(
          create: (_) => DeviceProvider(),
          update: (_, auth, device) => device!..updateAuth(auth),
        ),
        ChangeNotifierProxyProvider<AuthProvider, MqttProvider>(
          create: (_) => MqttProvider(),
          update: (_, auth, mqtt) => mqtt!..updateAuth(auth),
        ),
      ],
      child: MaterialApp(
        title: 'Solar Controller',
        theme: AppTheme.lightTheme,
        debugShowCheckedModeBanner: false,
        home: const AuthWrapper(),
      ),
    );
  }
}

class AuthWrapper extends StatelessWidget {
  const AuthWrapper({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, authProvider, _) {
        if (authProvider.isLoading) {
          return const SplashScreen();
        }

        if (authProvider.user == null) {
          return const LoginScreen();
        }

        // Set up MQTT after login
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final mqttProvider = context.read<MqttProvider>();
          final deviceProvider = context.read<DeviceProvider>();
          mqttProvider.setDeviceProvider(deviceProvider);
        });

        return const HomeScreen();
      },
    );
  }
}
