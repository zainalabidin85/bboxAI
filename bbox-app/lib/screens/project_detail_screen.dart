import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/project.dart';
import '../providers/project_provider.dart';
import '../services/api_service.dart';

class ProjectDetailScreen extends StatefulWidget {
  const ProjectDetailScreen({super.key});

  @override
  State<ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen> {
  Map<String, dynamic>? _stats;
  bool _loadingStats = true;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    final project = context.read<ProjectProvider>().currentProject;
    if (project == null) return;
    setState(() { _loadingStats = true; });
    try {
      final stats = await ApiService.getStats(project.id);
      if (mounted) setState(() { _stats = stats; });
    } catch (_) {
      if (mounted) setState(() { _stats = null; });
    } finally {
      if (mounted) setState(() { _loadingStats = false; });
    }
  }

  Future<void> _showAddClassesDialog(Project project) async {
    final ctrl = TextEditingController();
    String? err;

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Add Classes'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: ctrl,
                decoration: const InputDecoration(
                  labelText: 'New classes (comma-separated)',
                  hintText: 'e.g. eagle, hawk',
                  border: OutlineInputBorder(),
                ),
                autofocus: true,
              ),
              if (err != null) ...[
                const SizedBox(height: 8),
                Text(err!, style: const TextStyle(color: Colors.red, fontSize: 13)),
              ],
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo),
              onPressed: () async {
                final classes = ctrl.text
                    .split(',')
                    .map((s) => s.trim())
                    .where((s) => s.isNotEmpty)
                    .toList();
                if (classes.isEmpty) {
                  setDialogState(() { err = 'Enter at least one class name.'; });
                  return;
                }
                Navigator.pop(ctx);
                try {
                  await ApiService.addClasses(project.id, classes);
                  final updated = await ApiService.getProject(project.id);
                  if (mounted) context.read<ProjectProvider>().setProject(updated);
                } catch (_) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Failed to add classes.'), backgroundColor: Colors.red),
                    );
                  }
                }
              },
              child: const Text('Add', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final project = context.watch<ProjectProvider>().currentProject;
    if (project == null) {
      return const Scaffold(body: Center(child: Text('No project selected.')));
    }

    final totalBoxes = _stats?['total_boxes'] as int? ?? 0;
    final totalImages = _stats?['total'] as int? ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(project.name),
        backgroundColor: Colors.indigo,
        foregroundColor: Colors.white,
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadStats),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Stats row ───────────────────────────────────────────────────────
          Row(children: [
            _StatChip(label: 'Images', value: '$totalImages', color: Colors.indigo.shade700),
            const SizedBox(width: 10),
            _StatChip(label: 'Boxes', value: '$totalBoxes', color: Colors.orange.shade700),
            const SizedBox(width: 10),
            _StatChip(label: 'Classes', value: '${project.classes.length}', color: Colors.teal.shade700),
          ]),

          const SizedBox(height: 20),

          // ── Classes ─────────────────────────────────────────────────────────
          Row(
            children: [
              const Text('Classes', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              const Spacer(),
              TextButton.icon(
                onPressed: () => _showAddClassesDialog(project),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: project.classes.map((c) {
              return Chip(
                label: Text(c.name),
                avatar: CircleAvatar(
                  backgroundColor: Colors.indigo.shade100,
                  child: Text('${c.id}', style: const TextStyle(fontSize: 10, color: Colors.indigo)),
                ),
              );
            }).toList(),
          ),

          const SizedBox(height: 24),
          const Divider(),
          const SizedBox(height: 16),

          // ── Per-class stats ──────────────────────────────────────────────────
          if (!_loadingStats && _stats != null) ...[
            const Text('Labeled boxes per class', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            const SizedBox(height: 10),
            ...(_stats!['per_class'] as List).map((c) {
              final count = c['count'] as int;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(children: [
                  SizedBox(
                    width: 100,
                    child: Text(c['name'] as String,
                        style: const TextStyle(fontSize: 13), overflow: TextOverflow.ellipsis),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: LinearProgressIndicator(
                      value: totalBoxes > 0 ? count / totalBoxes : 0,
                      backgroundColor: Colors.grey.shade200,
                      color: Colors.indigo,
                      minHeight: 8,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text('$count', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                ]),
              );
            }),
            const SizedBox(height: 16),
            const Divider(),
            const SizedBox(height: 16),
          ],

          // ── Actions ──────────────────────────────────────────────────────────
          ElevatedButton.icon(
            onPressed: () => Navigator.pushNamed(context, '/camera').then((_) => _loadStats()),
            icon: const Icon(Icons.add_a_photo, color: Colors.white),
            label: const Text('Capture / Pick Image', style: TextStyle(fontSize: 15, color: Colors.white)),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.indigo,
              minimumSize: const Size.fromHeight(50),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => Navigator.pushNamed(context, '/stats'),
            icon: const Icon(Icons.model_training),
            label: const Text('Stats & Training', style: TextStyle(fontSize: 15)),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(50),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _StatChip({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(10)),
          child: Column(children: [
            Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
            Text(label, style: const TextStyle(fontSize: 11, color: Colors.white70)),
          ]),
        ),
      );
}
