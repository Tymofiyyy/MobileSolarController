import 'package:flutter/foundation.dart';
import 'package:mqtt_client/mqtt_client.dart';
import 'package:mqtt_client/mqtt_server_client.dart';
import 'package:mqtt_client/mqtt_browser_client.dart';
import 'dart:convert';
import 'dart:async';
import '../config/app_config.dart';
import 'auth_provider.dart';
import 'device_provider.dart';

class MqttProvider with ChangeNotifier {
  MqttClient? _client;
  AuthProvider? _authProvider;
  DeviceProvider? _deviceProvider;

  bool _isConnected = false;
  bool _isConnecting = false;
  String? _connectionError;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  final int _maxReconnectAttempts = 5;

  bool get isConnected => _isConnected;
  bool get isConnecting => _isConnecting;
  String? get connectionError => _connectionError;

  void updateAuth(AuthProvider authProvider) {
    _authProvider = authProvider;
    if (_authProvider?.isAuthenticated ?? false) {
      connect();
    } else {
      disconnect();
    }
  }

  void setDeviceProvider(DeviceProvider deviceProvider) {
    _deviceProvider = deviceProvider;
    debugPrint('MQTT: DeviceProvider linked');
  }

  Future<void> connect() async {
    if (_client != null || _isConnecting) {
      debugPrint('MQTT: Already connected or connecting');
      return;
    }

    if (_authProvider?.token == null) {
      debugPrint('MQTT: No auth token available');
      return;
    }

    _isConnecting = true;
    _connectionError = null;
    notifyListeners();

    try {
      final clientId = 'FlutterClient_${DateTime.now().millisecondsSinceEpoch}';

      // Створюємо клієнт залежно від платформи
      if (kIsWeb) {
        // Для веб використовуємо WebSocket
        final wsUrl = 'ws://${AppConfig.mqttHost}:9001/mqtt';
        _client = MqttBrowserClient(wsUrl, clientId);
        (_client as MqttBrowserClient).websocketProtocols = ['mqtt'];
        debugPrint('MQTT: Using WebSocket connection to $wsUrl');
      } else {
        // Для мобільних платформ
        _client = MqttServerClient(AppConfig.mqttHost, clientId);
        _client!.port = AppConfig.mqttPort;
        debugPrint(
            'MQTT: Using TCP connection to ${AppConfig.mqttHost}:${AppConfig.mqttPort}');
      }

      // Налаштування клієнта
      _client!.logging(on: kDebugMode);
      _client!.keepAlivePeriod = 60;
      _client!.autoReconnect = true;
      _client!.onConnected = _onConnected;
      _client!.onDisconnected = _onDisconnected;
      _client!.onAutoReconnect = _onAutoReconnect;
      _client!.onAutoReconnected = _onAutoReconnected;

      // Налаштування повідомлення підключення
      final connMessage = MqttConnectMessage()
          .withClientIdentifier(clientId)
          .startClean()
          .withWillQos(MqttQos.atLeastOnce);

      // Додаємо автентифікацію якщо налаштована
      if (AppConfig.mqttUsername.isNotEmpty) {
        connMessage.authenticateAs(
          AppConfig.mqttUsername,
          AppConfig.mqttPassword,
        );
      }

      _client!.connectionMessage = connMessage;

      debugPrint('MQTT: Connecting to broker...');
      await _client!.connect();
    } catch (e) {
      debugPrint('MQTT connection error: $e');
      _connectionError = 'Помилка підключення: ${e.toString()}';
      _isConnecting = false;
      _isConnected = false;
      notifyListeners();

      // Спробуємо перепідключитися
      _scheduleReconnect();
    }
  }

  void _onConnected() {
    _isConnected = true;
    _isConnecting = false;
    _connectionError = null;
    _reconnectAttempts = 0;
    notifyListeners();

    debugPrint('MQTT: Connected successfully');

    // Підписуємося на топіки
    _subscribeToTopics();

    // Слухаємо повідомлення
    _client!.updates!.listen(_handleMessage);
  }

  void _onDisconnected() {
    _isConnected = false;
    _isConnecting = false;
    notifyListeners();
    debugPrint('MQTT: Disconnected');

    // Якщо це не навмисне відключення, спробуємо перепідключитися
    if (_authProvider?.isAuthenticated ?? false) {
      _scheduleReconnect();
    }
  }

  void _onAutoReconnect() {
    debugPrint('MQTT: Auto-reconnecting...');
    _isConnecting = true;
    notifyListeners();
  }

  void _onAutoReconnected() {
    debugPrint('MQTT: Auto-reconnected');
    _isConnected = true;
    _isConnecting = false;
    notifyListeners();

    // Перепідписуємося на топіки
    _subscribeToTopics();
  }

  void _subscribeToTopics() {
    if (_client == null || !_isConnected) return;

    try {
      // Підписуємося на всі топіки пристроїв
      _client!.subscribe('solar/+/status', MqttQos.atLeastOnce);
      _client!.subscribe('solar/+/online', MqttQos.atLeastOnce);
      _client!.subscribe('solar/+/response', MqttQos.atLeastOnce);

      debugPrint('MQTT: Subscribed to topics');
    } catch (e) {
      debugPrint('MQTT: Error subscribing to topics: $e');
    }
  }

  void _handleMessage(List<MqttReceivedMessage<MqttMessage>> messages) {
    for (final message in messages) {
      final topic = message.topic;
      final payload = MqttPublishPayload.bytesToStringAsString(
        (message.payload as MqttPublishMessage).payload.message,
      );

      debugPrint('MQTT Message - Topic: $topic');

      final topicParts = topic.split('/');
      if (topicParts.length < 3) {
        debugPrint('MQTT: Invalid topic format: $topic');
        continue;
      }

      final deviceId = topicParts[1];
      final messageType = topicParts[2];

      try {
        switch (messageType) {
          case 'status':
            _handleStatusMessage(deviceId, payload);
            break;
          case 'online':
            _handleOnlineMessage(deviceId, payload);
            break;
          case 'response':
            _handleResponseMessage(deviceId, payload);
            break;
          default:
            debugPrint('MQTT: Unknown message type: $messageType');
        }
      } catch (e) {
        debugPrint('MQTT: Error handling message: $e');
      }
    }
  }

  void _handleStatusMessage(String deviceId, String payload) {
    try {
      final status = json.decode(payload);
      debugPrint('MQTT: Status from $deviceId: ${status['relayState']}');

      _deviceProvider?.updateDeviceStatus(deviceId, {
        'online': true,
        'relayState': status['relayState'] ?? false,
        'wifiRSSI': status['wifiRSSI'],
        'uptime': status['uptime'],
        'freeHeap': status['freeHeap'],
        'lastSeen': DateTime.now(),
      });
    } catch (e) {
      debugPrint('MQTT: Error parsing status: $e');
    }
  }

  void _handleOnlineMessage(String deviceId, String payload) {
    final isOnline = payload.toLowerCase() == 'true' || payload == '1';
    debugPrint('MQTT: Device $deviceId is ${isOnline ? 'online' : 'offline'}');

    _deviceProvider?.updateDeviceStatus(deviceId, {
      'online': isOnline,
      'lastSeen': DateTime.now(),
    });
  }

  void _handleResponseMessage(String deviceId, String payload) {
    try {
      final response = json.decode(payload);
      debugPrint('MQTT: Response from $deviceId: $payload');

      // Якщо це відповідь на команду реле
      if (response['command'] == 'relay' && response['success'] == true) {
        _deviceProvider?.updateDeviceStatus(deviceId, {
          'relayState': response['state'] ?? false,
          'lastSeen': DateTime.now(),
        });
      }
    } catch (e) {
      debugPrint('MQTT: Error parsing response: $e');
    }
  }

  Future<void> publishCommand(
      String deviceId, String command, dynamic state) async {
    if (_client == null || !_isConnected) {
      debugPrint('MQTT: Cannot send command - not connected');
      _connectionError = 'Не підключено до MQTT';
      notifyListeners();

      // Спробуємо підключитися і відправити команду
      await connect();
      if (!_isConnected) {
        throw Exception('MQTT не підключено');
      }
    }

    try {
      final topic = 'solar/$deviceId/command';
      final message = json.encode({
        'command': command,
        'state': state,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });

      final builder = MqttClientPayloadBuilder();
      builder.addString(message);

      _client!.publishMessage(
        topic,
        MqttQos.atLeastOnce,
        builder.payload!,
      );

      debugPrint('MQTT: Published to $topic: $message');

      // Оновлюємо локальний статус одразу для швидкого відгуку UI
      if (command == 'relay' && _deviceProvider != null) {
        _deviceProvider!.updateDeviceStatus(deviceId, {
          'relayState': state,
        });
      }
    } catch (e) {
      debugPrint('MQTT: Error publishing command: $e');
      throw e;
    }
  }

  Future<void> requestDeviceStatus(String deviceId) async {
    if (!_isConnected) return;

    try {
      final topic = 'solar/$deviceId/request';
      final message = json.encode({
        'request': 'status',
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });

      final builder = MqttClientPayloadBuilder();
      builder.addString(message);

      _client!.publishMessage(
        topic,
        MqttQos.atLeastOnce,
        builder.payload!,
      );

      debugPrint('MQTT: Requested status from $deviceId');
    } catch (e) {
      debugPrint('MQTT: Error requesting status: $e');
    }
  }

  void _scheduleReconnect() {
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      debugPrint('MQTT: Max reconnect attempts reached');
      _connectionError = 'Не вдалося підключитися до сервера';
      notifyListeners();
      return;
    }

    _reconnectTimer?.cancel();

    final delay = Duration(seconds: 5 * (_reconnectAttempts + 1));
    _reconnectAttempts++;

    debugPrint(
        'MQTT: Scheduling reconnect attempt $_reconnectAttempts in ${delay.inSeconds}s');

    _reconnectTimer = Timer(delay, () {
      if (_authProvider?.isAuthenticated ?? false) {
        connect();
      }
    });
  }

  void disconnect() {
    debugPrint('MQTT: Disconnecting...');

    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _reconnectAttempts = 0;

    _client?.disconnect();
    _client = null;

    _isConnected = false;
    _isConnecting = false;
    _connectionError = null;
    notifyListeners();
  }

  Future<void> reconnect() async {
    disconnect();
    await Future.delayed(const Duration(seconds: 1));
    await connect();
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel();
    disconnect();
    super.dispose();
  }
}
