import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/project.dart';

class ApiService {
  static const _keyServerUrl = 'server_url';
  static const _keyTagger    = 'tagger_name';
  static const _keyToken     = 'auth_token';
  static const _keyUsername  = 'username';

  static String? _token;

  // ── Settings ───────────────────────────────────────────────────────────────

  static const _defaultServerUrl = 'https://bboxai.unitani.com';

  static Future<String> getServerUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyServerUrl) ?? _defaultServerUrl;
  }

  static Future<String> getTaggerName() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyTagger) ?? '';
  }

  static Future<void> saveSettings(String serverUrl, String tagger) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyServerUrl, serverUrl.trim());
    await prefs.setString(_keyTagger, tagger.trim());
  }

  // ── Auth token ─────────────────────────────────────────────────────────────

  static Future<void> loadToken() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString(_keyToken);
  }

  static Future<void> _saveToken(String token, String username) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyToken, token);
    await prefs.setString(_keyUsername, username);
  }

  static Future<void> logout() async {
    _token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyToken);
    await prefs.remove(_keyUsername);
  }

  static bool get isLoggedIn => _token != null;

  static Future<String> getUsername() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyUsername) ?? '';
  }

  // ── Dio factory ────────────────────────────────────────────────────────────

  static Future<Dio> _dio({bool auth = true}) async {
    final url = await getServerUrl();
    if (url.isEmpty) throw Exception('Server URL not configured.');
    final options = BaseOptions(
      baseUrl: url,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 60),
    );
    if (auth && _token != null) {
      options.headers['Authorization'] = 'Bearer $_token';
    }
    return Dio(options);
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  static Future<void> register(String username, String email, String password) async {
    final dio = await _dio(auth: false);
    await dio.post('/auth/register', data: {
      'username': username,
      'email': email,
      'password': password,
    });
  }

  static Future<void> login(String username, String password) async {
    final dio = await _dio(auth: false);
    final res = await dio.post(
      '/auth/login',
      data: FormData.fromMap({'username': username, 'password': password}),
      options: Options(contentType: 'application/x-www-form-urlencoded'),
    );
    final token = res.data['access_token'] as String;
    final uname = res.data['username'] as String;
    await _saveToken(token, uname);
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  static Future<List<Project>> getProjects() async {
    final dio = await _dio();
    final res = await dio.get('/projects');
    return (res.data as List).map((e) => Project.fromJson(e as Map<String, dynamic>)).toList();
  }

  static Future<Project> createProject(String name, List<String> classes) async {
    final dio = await _dio();
    final res = await dio.post('/projects', data: {'name': name, 'classes': classes});
    return Project.fromJson(res.data as Map<String, dynamic>);
  }

  static Future<Project> getProject(String id) async {
    final dio = await _dio();
    final res = await dio.get('/projects/$id');
    return Project.fromJson(res.data as Map<String, dynamic>);
  }

  static Future<void> deleteProject(String id) async {
    final dio = await _dio();
    await dio.delete('/projects/$id');
  }

  static Future<void> addClasses(String projectId, List<String> classes) async {
    final dio = await _dio();
    await dio.patch('/projects/$projectId/classes', data: {'classes': classes});
  }

  static Future<void> updateVisibility(String projectId, {required bool isPublic}) async {
    final dio = await _dio();
    await dio.patch('/projects/$projectId/visibility', data: {'is_public': isPublic});
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  static Future<void> uploadAnnotated({
    required String projectId,
    required String imagePath,
    required List<Map<String, dynamic>> annotations,
  }) async {
    final dio = await _dio();
    final tagger = await getTaggerName();
    final formData = FormData.fromMap({
      'file': await MultipartFile.fromFile(imagePath, filename: 'capture.jpg'),
      'annotations': jsonEncode(annotations),
      'tagger': tagger.isEmpty ? 'anonymous' : tagger,
      'notes': '',
    });
    await dio.post(
      '/projects/$projectId/upload',
      data: formData,
      options: Options(contentType: 'multipart/form-data'),
    );
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  static Future<Map<String, dynamic>> getStats(String projectId) async {
    final dio = await _dio();
    final res = await dio.get('/projects/$projectId/stats');
    return res.data as Map<String, dynamic>;
  }

  // ── Training ───────────────────────────────────────────────────────────────

  static Future<void> startTraining({
    required String projectId,
    required String baseModel,
    required int epochs,
    required int imgsz,
  }) async {
    final dio = await _dio();
    await dio.post('/projects/$projectId/train', data: {
      'base_model': baseModel,
      'epochs': epochs,
      'imgsz': imgsz,
    });
  }

  static Future<Map<String, dynamic>> getTrainingStatus(String projectId) async {
    final dio = await _dio();
    final res = await dio.get('/projects/$projectId/train/status');
    return res.data as Map<String, dynamic>;
  }

  static Future<List<String>> getWeights() async {
    final dio = await _dio();
    final res = await dio.get('/weights');
    return (res.data as List).map((e) => e['filename'] as String).toList();
  }

  // ── Download URLs ──────────────────────────────────────────────────────────

  static Future<String> reportUrl(String projectId) async {
    final url = await getServerUrl();
    return '$url/projects/$projectId/report';
  }

  static Future<String> modelDownloadUrl(String projectId) async {
    final url = await getServerUrl();
    return '$url/projects/$projectId/weights/download';
  }

  // ── Catalog ────────────────────────────────────────────────────────────────

  static Future<List<Map<String, dynamic>>> getCatalog() async {
    final dio = await _dio(auth: false);
    final res = await dio.get('/models');
    return (res.data as List).cast<Map<String, dynamic>>();
  }

  static Future<List<Map<String, dynamic>>> searchModels(String classes) async {
    final dio = await _dio(auth: false);
    final res = await dio.get('/models/search', queryParameters: {'classes': classes});
    return (res.data as List).cast<Map<String, dynamic>>();
  }
}
