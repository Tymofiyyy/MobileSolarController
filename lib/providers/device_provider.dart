import 'package:flutter/foundation.dart';
import '../models/device.dart';
import '../services/api_service.dart';
import 'auth_provider.dart';

class DeviceProvider with ChangeNotifier {
  final ApiService _apiService = ApiService();
  AuthProvider? _authProvider;

  List<Device> _devices = [];
  bool _isLoading = false;
  String? _error;

  List<Device> get devices => _devices;
  bool get isLoading => _isLoading;
  String? get error => _error;

  void updateAuth(AuthProvider authProvider) {
    _authProvider = authProvider;
    if (_authProvider?.isAuthenticated ?? false) {
      fetchDevices();
    }
  }

  Future<void> fetchDevices() async {
    if (_authProvider?.token == null) return;

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await _apiService.getDevices(_authProvider!.token!);
      _devices = data.map<Device>((json) => Device.fromJson(json)).toList();
    } catch (e) {
      _error = 'Помилка завантаження пристроїв';
      debugPrint('Error fetching devices: $e');
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> addDevice(
      String deviceId, String confirmationCode, String? name) async {
    if (_authProvider?.token == null) return false;

    try {
      final device = await _apiService.addDevice(
        _authProvider!.token!,
        deviceId,
        confirmationCode,
        name,
      );

      _devices.add(Device.fromJson(device));
      notifyListeners();
      return true;
    } catch (e) {
      debugPrint('Error adding device: $e');
      return false;
    }
  }

  Future<bool> toggleRelay(String deviceId, bool currentState) async {
    if (_authProvider?.token == null) return false;

    try {
      // Оновлюємо локальний стан ВІДРАЗУ для швидкого відгуку
      final index = _devices.indexWhere((d) => d.deviceId == deviceId);
      if (index != -1 && _devices[index].status != null) {
        _devices[index].status!.relayState = !currentState;
        notifyListeners();
      }

      // Відправляємо команду на сервер
      await _apiService.controlDevice(
        _authProvider!.token!,
        deviceId,
        'relay',
        !currentState,
      );

      return true;
    } catch (e) {
      debugPrint('Error toggling relay: $e');

      // Якщо помилка - повертаємо стан назад
      final index = _devices.indexWhere((d) => d.deviceId == deviceId);
      if (index != -1 && _devices[index].status != null) {
        _devices[index].status!.relayState = currentState;
        notifyListeners();
      }

      return false;
    }
  }

  Future<bool> deleteDevice(String deviceId) async {
    if (_authProvider?.token == null) return false;

    try {
      await _apiService.deleteDevice(_authProvider!.token!, deviceId);

      _devices.removeWhere((d) => d.deviceId == deviceId);
      notifyListeners();
      return true;
    } catch (e) {
      debugPrint('Error deleting device: $e');
      return false;
    }
  }

  Future<bool> shareDevice(String deviceId, String email) async {
    if (_authProvider?.token == null) return false;

    try {
      await _apiService.shareDevice(_authProvider!.token!, deviceId, email);
      return true;
    } catch (e) {
      debugPrint('Error sharing device: $e');
      return false;
    }
  }

  void updateDeviceStatus(String deviceId, Map<String, dynamic> status) {
    final index = _devices.indexWhere((d) => d.deviceId == deviceId);
    if (index != -1) {
      final device = _devices[index];
      final currentStatus = device.status ??
          DeviceStatus(
            online: false,
            relayState: false,
          );

      // Update status fields
      final updatedStatus = DeviceStatus(
        online: status['online'] ?? currentStatus.online,
        relayState: status['relayState'] ?? currentStatus.relayState,
        wifiRSSI: status['wifiRSSI'] ?? currentStatus.wifiRSSI,
        uptime: status['uptime'] ?? currentStatus.uptime,
        freeHeap: status['freeHeap'] ?? currentStatus.freeHeap,
        lastSeen: DateTime.now(),
      );

      _devices[index] = device.copyWith(status: updatedStatus);
      notifyListeners();
    }
  }
}
