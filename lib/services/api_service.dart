import 'package:dio/dio.dart';
import '../config/app_config.dart';

class ApiService {
  late final Dio _dio;

  ApiService() {
    _dio = Dio(BaseOptions(
      baseUrl: AppConfig.apiUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
    ));

    _dio.interceptors.add(LogInterceptor(
      requestBody: true,
      responseBody: true,
      error: true,
    ));
  }

  // Test login
  Future<Map<String, dynamic>> testLogin() async {
    try {
      final response = await _dio.post('/auth/test', data: {
        'email': 'test@solar.com',
      });
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> authenticateWithGoogle(String idToken) async {
    try {
      final response = await _dio.post('/auth/google', data: {
        'credential': idToken,
      });
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> getCurrentUser(String token) async {
    try {
      final response = await _dio.get(
        '/auth/me',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  // Devices
  Future<List<dynamic>> getDevices(String token) async {
    try {
      final response = await _dio.get(
        '/devices',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<Map<String, dynamic>> addDevice(
    String token,
    String deviceId,
    String confirmationCode,
    String? name,
  ) async {
    try {
      final response = await _dio.post(
        '/devices',
        data: {
          'deviceId': deviceId,
          'confirmationCode': confirmationCode,
          'name': name,
        },
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      return response.data;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> deleteDevice(String token, String deviceId) async {
    try {
      await _dio.delete(
        '/devices/$deviceId',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> controlDevice(
    String token,
    String deviceId,
    String command,
    bool state,
  ) async {
    try {
      await _dio.post(
        '/devices/$deviceId/control',
        data: {
          'command': command,
          'state': state,
        },
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  Future<void> shareDevice(String token, String deviceId, String email) async {
    try {
      await _dio.post(
        '/devices/$deviceId/share',
        data: {'email': email},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  String _handleError(DioException error) {
    if (error.response != null) {
      final data = error.response!.data;
      if (data is Map && data.containsKey('error')) {
        return data['error'];
      }
    }

    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return 'Timeout - перевірте підключення';
      case DioExceptionType.connectionError:
        return 'Помилка підключення до сервера';
      default:
        return 'Невідома помилка';
    }
  }
}
