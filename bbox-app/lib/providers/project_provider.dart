import 'package:flutter/material.dart';
import '../models/project.dart';

class ProjectProvider extends ChangeNotifier {
  Project? _currentProject;

  Project? get currentProject => _currentProject;

  void setProject(Project project) {
    _currentProject = project;
    notifyListeners();
  }

  void clear() {
    _currentProject = null;
    notifyListeners();
  }
}
