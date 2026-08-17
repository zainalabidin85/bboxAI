import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'providers/project_provider.dart';
import 'services/api_service.dart';
import 'screens/settings_screen.dart';
import 'screens/login_screen.dart';
import 'screens/register_screen.dart';
import 'screens/projects_screen.dart';
import 'screens/project_detail_screen.dart';
import 'screens/camera_screen.dart';
import 'screens/annotation_screen.dart';
import 'screens/stats_screen.dart';
import 'screens/catalog_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiService.loadToken();

  final prefs = await SharedPreferences.getInstance();
  final hasUrl   = (prefs.getString('server_url') ?? '').isNotEmpty;
  final hasToken = ApiService.isLoggedIn;

  String initialRoute = '/settings';
  if (hasUrl && hasToken) {
    initialRoute = '/projects';
  } else if (hasUrl) {
    initialRoute = '/login';
  }

  runApp(BboxApp(initialRoute: initialRoute));
}

class BboxApp extends StatelessWidget {
  final String initialRoute;
  const BboxApp({super.key, required this.initialRoute});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ProjectProvider()),
      ],
      child: MaterialApp(
        title: 'bboxAI',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
          useMaterial3: true,
        ),
        initialRoute: initialRoute,
        routes: {
          '/settings':       (_) => const SettingsScreen(),
          '/login':          (_) => const LoginScreen(),
          '/register':       (_) => const RegisterScreen(),
          '/projects':       (_) => const ProjectsScreen(),
          '/project-detail': (_) => const ProjectDetailScreen(),
          '/camera':         (_) => const CameraScreen(),
          '/annotation':     (_) => const AnnotationScreen(),
          '/stats':          (_) => const StatsScreen(),
          '/catalog':        (_) => const CatalogScreen(),
        },
      ),
    );
  }
}
