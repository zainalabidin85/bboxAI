import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/project_provider.dart';
import '../services/api_service.dart';

class StatsScreen extends StatefulWidget {
  const StatsScreen({super.key});

  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  Map<String, dynamic>? _stats;
  Map<String, dynamic>? _trainStatus;
  bool _loading = true;
  String? _error;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final project = context.read<ProjectProvider>().currentProject;
    if (project == null) return;
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        ApiService.getStats(project.id),
        ApiService.getTrainingStatus(project.id),
      ]);
      if (mounted) {
        setState(() {
          _stats = results[0];
          _trainStatus = results[1];
        });
        _managePollTimer();
      }
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not load stats. Check server connection.'; });
    } finally {
      if (mounted) setState(() { _loading = false; });
    }
  }

  void _managePollTimer() {
    final state = _trainStatus?['state'] as String? ?? 'idle';
    if (state == 'running') {
      _pollTimer ??= Timer.periodic(const Duration(seconds: 8), (_) => _pollStatus());
    } else {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
  }

  Future<void> _pollStatus() async {
    final project = context.read<ProjectProvider>().currentProject;
    if (project == null) return;
    try {
      final status = await ApiService.getTrainingStatus(project.id);
      if (mounted) {
        setState(() { _trainStatus = status; });
        _managePollTimer();
      }
    } catch (_) {}
  }

  Future<void> _showTrainConfig() async {
    final project = context.read<ProjectProvider>().currentProject;
    if (project == null) return;

    List<String> weights = [];
    try {
      weights = await ApiService.getWeights();
    } catch (_) {}

    if (!mounted) return;

    if (weights.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No base models found in weights/ on server. Add a .pt file first.'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _TrainConfigSheet(
        weights: weights,
        onStart: (baseModel, epochs, imgsz) async {
          try {
            await ApiService.startTraining(
              projectId: project.id,
              baseModel: baseModel,
              epochs: epochs,
              imgsz: imgsz,
            );
            await _pollStatus();
            _managePollTimer();
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: const Text('Training started on server.'),
                  backgroundColor: Colors.green.shade700,
                ),
              );
            }
          } on Exception catch (e) {
            final msg = e.toString();
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(msg.contains('400') ? msg : 'Failed to start training.'),
                  backgroundColor: Colors.red,
                ),
              );
            }
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final project = context.watch<ProjectProvider>().currentProject;

    return Scaffold(
      appBar: AppBar(
        title: Text(project != null ? '${project.name} — Stats' : 'Stats'),
        backgroundColor: Colors.indigo,
        foregroundColor: Colors.white,
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text(_error!, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      ElevatedButton(onPressed: _load, child: const Text('Retry')),
                    ]),
                  ),
                )
              : _buildBody(),
    );
  }

  Widget _buildBody() {
    final total      = _stats!['total'] as int;
    final labeled    = _stats!['labeled'] as int;
    final totalBoxes = _stats!['total_boxes'] as int;
    final perClass   = _stats!['per_class'] as List;
    final state      = _trainStatus?['state'] as String? ?? 'idle';
    const minBoxes   = 10;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // ── Summary cards ─────────────────────────────────────────────────────
        Row(children: [
          Expanded(child: _StatCard(value: '$total',      label: 'Images',  color: Colors.indigo.shade700)),
          const SizedBox(width: 10),
          Expanded(child: _StatCard(value: '$labeled',    label: 'Labeled', color: Colors.blue.shade700)),
          const SizedBox(width: 10),
          Expanded(child: _StatCard(value: '$totalBoxes', label: 'Boxes',   color: Colors.orange.shade700)),
        ]),

        const SizedBox(height: 20),

        // ── Per-class breakdown ───────────────────────────────────────────────
        const Text('Boxes per class', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        const SizedBox(height: 10),
        ...perClass.map((c) {
          final count = c['count'] as int;
          final frac  = totalBoxes > 0 ? count / totalBoxes : 0.0;
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(children: [
              SizedBox(
                width: 90,
                child: Text(c['name'] as String,
                    style: const TextStyle(fontSize: 13), overflow: TextOverflow.ellipsis),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: frac,
                    backgroundColor: Colors.grey.shade200,
                    color: Colors.indigo,
                    minHeight: 10,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 32,
                child: Text('$count',
                    textAlign: TextAlign.right,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
              ),
            ]),
          );
        }),

        const SizedBox(height: 20),
        const Divider(),
        const SizedBox(height: 16),

        // ── Training section ──────────────────────────────────────────────────
        const Text('Model Training', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),

        if (state == 'running') ...[
          _TrainingProgressCard(status: _trainStatus!),
        ] else if (state == 'done') ...[
          _TrainingResultCard(status: _trainStatus!, success: true),
          const SizedBox(height: 12),
          _DownloadButtons(projectId: context.read<ProjectProvider>().currentProject!.id),
          const SizedBox(height: 16),
          _buildTrainButton(totalBoxes, minBoxes),
        ] else if (state == 'failed') ...[
          _TrainingResultCard(status: _trainStatus!, success: false),
          const SizedBox(height: 16),
          _buildTrainButton(totalBoxes, minBoxes),
        ] else ...[
          _buildTrainButton(totalBoxes, minBoxes),
        ],
      ],
    );
  }

  Widget _buildTrainButton(int totalBoxes, int minBoxes) {
    final ready = totalBoxes >= minBoxes;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ElevatedButton.icon(
          onPressed: ready ? _showTrainConfig : null,
          icon: const Icon(Icons.model_training, color: Colors.white),
          label: const Text('Train Model', style: TextStyle(fontSize: 15, color: Colors.white)),
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.indigo.shade800,
            disabledBackgroundColor: Colors.grey.shade400,
            minimumSize: const Size.fromHeight(52),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
        if (!ready)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Collect at least $minBoxes labeled boxes to enable training. ($totalBoxes / $minBoxes)',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
            ),
          ),
      ],
    );
  }
}

// ── Train config bottom sheet ─────────────────────────────────────────────────

class _TrainConfigSheet extends StatefulWidget {
  final List<String> weights;
  final Future<void> Function(String baseModel, int epochs, int imgsz) onStart;

  const _TrainConfigSheet({required this.weights, required this.onStart});

  @override
  State<_TrainConfigSheet> createState() => _TrainConfigSheetState();
}

class _TrainConfigSheetState extends State<_TrainConfigSheet> {
  late String _selectedModel;
  double _epochs = 100;
  int _imgsz = 640;
  bool _starting = false;

  static const _imgszOptions = [320, 640, 1280];

  @override
  void initState() {
    super.initState();
    _selectedModel = widget.weights.first;
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(context).padding.bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Training Configuration',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 20),

          // Base model
          const Text('Base model', style: TextStyle(fontWeight: FontWeight.w500)),
          const SizedBox(height: 6),
          DropdownButtonFormField<String>(
            initialValue: _selectedModel,
            decoration: const InputDecoration(border: OutlineInputBorder()),
            items: widget.weights
                .map((w) => DropdownMenuItem(value: w, child: Text(w)))
                .toList(),
            onChanged: (v) { if (v != null) setState(() { _selectedModel = v; }); },
          ),

          const SizedBox(height: 16),

          // Epochs
          Row(children: [
            const Text('Epochs', style: TextStyle(fontWeight: FontWeight.w500)),
            const Spacer(),
            Text('${_epochs.toInt()}',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ]),
          Slider(
            value: _epochs,
            min: 50,
            max: 300,
            divisions: 25,
            activeColor: Colors.indigo,
            onChanged: (v) => setState(() { _epochs = v; }),
          ),

          const SizedBox(height: 8),

          // Image size
          const Text('Image size (imgsz)', style: TextStyle(fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          Row(
            children: _imgszOptions.map((sz) {
              final selected = _imgsz == sz;
              return Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: ChoiceChip(
                    label: Center(child: Text('$sz')),
                    selected: selected,
                    selectedColor: Colors.indigo,
                    labelStyle: TextStyle(
                      color: selected ? Colors.white : Colors.black87,
                      fontWeight: FontWeight.bold,
                    ),
                    onSelected: (_) => setState(() { _imgsz = sz; }),
                  ),
                ),
              );
            }).toList(),
          ),

          const SizedBox(height: 24),

          ElevatedButton.icon(
            onPressed: _starting
                ? null
                : () async {
                    setState(() { _starting = true; });
                    Navigator.pop(context);
                    await widget.onStart(_selectedModel, _epochs.toInt(), _imgsz);
                  },
            icon: _starting
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.rocket_launch, color: Colors.white),
            label: Text(
              _starting ? 'Starting...' : 'Start Training',
              style: const TextStyle(fontSize: 15, color: Colors.white),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.indigo.shade800,
              minimumSize: const Size.fromHeight(50),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Supporting widgets ────────────────────────────────────────────────────────

class _StatCard extends StatelessWidget {
  final String value;
  final String label;
  final Color color;
  const _StatCard({required this.value, required this.label, required this.color});

  @override
  Widget build(BuildContext context) => Card(
        color: color,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 18),
          child: Column(children: [
            Text(value, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.white)),
            Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
          ]),
        ),
      );
}

class _TrainingProgressCard extends StatelessWidget {
  final Map<String, dynamic> status;
  const _TrainingProgressCard({required this.status});

  @override
  Widget build(BuildContext context) {
    final done  = status['epochs_done'] as int? ?? 0;
    final total = status['total_epochs'] as int? ?? 100;
    final pct   = total > 0 ? done / total : 0.0;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.blue.shade200),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          SizedBox(width: 18, height: 18,
              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.blue.shade700)),
          const SizedBox(width: 10),
          Text('Training in progress…',
              style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blue.shade800)),
        ]),
        const SizedBox(height: 14),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: pct,
            backgroundColor: Colors.blue.shade100,
            color: Colors.blue.shade600,
            minHeight: 10,
          ),
        ),
        const SizedBox(height: 8),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('Epoch $done / $total',
              style: TextStyle(color: Colors.blue.shade700, fontSize: 13)),
          Text('${(pct * 100).toStringAsFixed(0)}%',
              style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blue.shade700)),
        ]),
        const SizedBox(height: 6),
        Text(
          'Model: ${status['base_model'] ?? '—'}   '
          'Images: ${status['total_images']}   Boxes: ${status['total_boxes']}',
          style: TextStyle(color: Colors.blue.shade400, fontSize: 12),
        ),
      ]),
    );
  }
}

class _TrainingResultCard extends StatelessWidget {
  final Map<String, dynamic> status;
  final bool success;
  const _TrainingResultCard({required this.status, required this.success});

  String _pct(String key) {
    final v = status[key];
    if (v == null) return '—';
    return '${((v as num) * 100).toStringAsFixed(1)}%';
  }

  @override
  Widget build(BuildContext context) {
    final color     = success ? Colors.green : Colors.red;
    final hasMetrics = success && status['map50'] != null;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.shade50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.shade200),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(success ? Icons.check_circle : Icons.error_outline,
              color: color.shade700, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                success ? 'Training complete — model deployed!' : 'Training failed',
                style: TextStyle(fontWeight: FontWeight.bold, color: color.shade800),
              ),
              if (success)
                Text('best.pt saved to project weights folder.',
                    style: TextStyle(color: color.shade700, fontSize: 13))
              else if (status['error'] != null)
                Text('${status['error']}',
                    style: TextStyle(color: color.shade700, fontSize: 12)),
            ]),
          ),
        ]),
        if (hasMetrics) ...[
          const SizedBox(height: 14),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Row(children: [
            _MetricChip(label: 'mAP50',     value: _pct('map50'),      color: color),
            const SizedBox(width: 6),
            _MetricChip(label: 'mAP50-95',  value: _pct('map50_95'),   color: color),
            const SizedBox(width: 6),
            _MetricChip(label: 'Precision',  value: _pct('precision'),  color: color),
            const SizedBox(width: 6),
            _MetricChip(label: 'Recall',    value: _pct('recall'),     color: color),
          ]),
        ],
      ]),
    );
  }
}

class _DownloadButtons extends StatelessWidget {
  final String projectId;
  const _DownloadButtons({required this.projectId});

  Future<void> _open(BuildContext context, Future<String> urlFuture) async {
    try {
      final url = Uri.parse(await urlFuture);
      if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
        throw Exception('Could not open URL');
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open link.'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () => _open(context, ApiService.reportUrl(projectId)),
            icon: const Icon(Icons.picture_as_pdf, color: Colors.red),
            label: const Text('Download Report'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
              side: const BorderSide(color: Colors.red),
              foregroundColor: Colors.red,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () => _open(context, ApiService.modelDownloadUrl(projectId)),
            icon: const Icon(Icons.download, color: Colors.indigo),
            label: const Text('Download Model'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
              side: BorderSide(color: Colors.indigo.shade400),
              foregroundColor: Colors.indigo,
            ),
          ),
        ),
      ],
    );
  }
}

class _MetricChip extends StatelessWidget {
  final String label;
  final String value;
  final MaterialColor color;
  const _MetricChip({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: color.shade100,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(children: [
            Text(value,
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: color.shade800)),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(fontSize: 10, color: color.shade600)),
          ]),
        ),
      );
}
