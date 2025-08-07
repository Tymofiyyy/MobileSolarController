import 'package:flutter_dotenv/flutter_dotenv.dart';

class AppConfig {
  static String get apiUrl =>
      dotenv.env['API_URL'] ?? 'http://localhost:3000/api';
  static String get mqttHost => dotenv.env['MQTT_HOST'] ?? 'localhost';
  static int get mqttPort => int.parse(dotenv.env['MQTT_PORT'] ?? '1883');
  static String get mqttUsername => dotenv.env['MQTT_USERNAME'] ?? '';
  static String get mqttPassword => dotenv.env['MQTT_PASSWORD'] ?? '';
  static String get googleClientId => dotenv.env['GOOGLE_CLIENT_ID'] ?? '';
}
