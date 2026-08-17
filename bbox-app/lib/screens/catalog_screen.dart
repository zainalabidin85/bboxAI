import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  List<Map<String, dynamic>> _models = [];
  bool _loading = true;
  String? _error;
  final _searchCtrl = TextEditingController();
  bool _searched = false;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() { _loading = true; _error = null; _searched = false; });
    try {
      final models = await ApiService.getCatalog();
      if (mounted) setState(() { _models = models; });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not load catalog.'; });
    } finally {
      if (mounted) setState(() { _loading = false; });
    }
  }

  Future<void> _search() async {
    final query = _searchCtrl.text.trim();
    if (query.isEmpty) { _loadAll(); return; }
    setState(() { _loading = true; _error = null; _searched = true; });
    try {
      final models = await ApiService.searchModels(query);
      if (mounted) setState(() { _models = models; });
    } catch (_) {
      if (mounted) setState(() { _error = 'Search failed.'; });
    } finally {
      if (mounted) setState(() { _loading = false; });
    }
  }

  Future<void> _openUrl(String url) async {
    final serverUrl = await ApiService.getServerUrl();
    final uri = Uri.parse('$serverUrl$url');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open link.'), backgroundColor: Colors.red),
        );
      }
    }
  }

  String _fmtPct(dynamic v) => v == null ? '—' : '${((v as num) * 100).toStringAsFixed(1)}%';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Model Catalog'),
        backgroundColor: Colors.indigo,
        foregroundColor: Colors.white,
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _loadAll)],
      ),
      body: Column(
        children: [
          // ── Search bar ───────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _searchCtrl,
                  decoration: InputDecoration(
                    hintText: 'Search by class name (e.g. cat, dog)',
                    border: const OutlineInputBorder(),
                    prefixIcon: const Icon(Icons.search),
                    isDense: true,
                    suffixIcon: _searchCtrl.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear),
                            onPressed: () { _searchCtrl.clear(); _loadAll(); },
                          )
                        : null,
                  ),
                  onSubmitted: (_) => _search(),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton(
                onPressed: _search,
                style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo),
                child: const Text('Search', style: TextStyle(color: Colors.white)),
              ),
            ]),
          ),

          if (_searched && !_loading)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(children: [
                Text('${_models.length} result${_models.length != 1 ? 's' : ''} for "${_searchCtrl.text}"',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
                const Spacer(),
                TextButton(onPressed: _loadAll, child: const Text('Clear')),
              ]),
            ),

          // ── List ─────────────────────────────────────────────────────────
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
                    : _models.isEmpty
                        ? Center(
                            child: Column(mainAxisSize: MainAxisSize.min, children: [
                              Icon(Icons.model_training, size: 64, color: Colors.grey.shade300),
                              const SizedBox(height: 12),
                              Text(
                                _searched ? 'No models found for that search.' : 'No public models yet.',
                                style: TextStyle(color: Colors.grey.shade500),
                              ),
                            ]),
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                            itemCount: _models.length,
                            itemBuilder: (_, i) => _ModelCard(
                              model: _models[i],
                              onDownloadModel: () => _openUrl(_models[i]['download_url'] as String),
                              onDownloadReport: () => _openUrl(_models[i]['report_url'] as String),
                              fmtPct: _fmtPct,
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

class _ModelCard extends StatelessWidget {
  final Map<String, dynamic> model;
  final VoidCallback onDownloadModel;
  final VoidCallback onDownloadReport;
  final String Function(dynamic) fmtPct;

  const _ModelCard({
    required this.model,
    required this.onDownloadModel,
    required this.onDownloadReport,
    required this.fmtPct,
  });

  @override
  Widget build(BuildContext context) {
    final classes = (model['classes'] as List)
        .map((c) => c['name'] as String)
        .toList();

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          // Header
          Row(children: [
            const Icon(Icons.folder, color: Colors.indigo, size: 18),
            const SizedBox(width: 6),
            Expanded(
              child: Text(model['project_name'] as String,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            ),
            Text('by ${model['owner']}',
                style: TextStyle(color: Colors.grey.shade500, fontSize: 11)),
          ]),
          const SizedBox(height: 8),

          // Classes
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: classes.map((c) => Chip(
              label: Text(c, style: const TextStyle(fontSize: 11)),
              padding: EdgeInsets.zero,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              backgroundColor: Colors.indigo.shade50,
            )).toList(),
          ),
          const SizedBox(height: 10),

          // Metrics
          Row(children: [
            _Metric(label: 'mAP50',     value: fmtPct(model['map50'])),
            _Metric(label: 'mAP50-95',  value: fmtPct(model['map50_95'])),
            _Metric(label: 'Precision', value: fmtPct(model['precision'])),
            _Metric(label: 'Recall',    value: fmtPct(model['recall'])),
          ]),
          const SizedBox(height: 4),
          Text(
            '${model['base_model']}  ·  ${model['epochs']} epochs  ·  imgsz ${model['imgsz']}',
            style: TextStyle(color: Colors.grey.shade500, fontSize: 11),
          ),
          const SizedBox(height: 10),

          // Actions
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: onDownloadReport,
                icon: const Icon(Icons.picture_as_pdf, size: 16, color: Colors.red),
                label: const Text('Report', style: TextStyle(fontSize: 12, color: Colors.red)),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Colors.red),
                  padding: const EdgeInsets.symmetric(vertical: 6),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: onDownloadModel,
                icon: const Icon(Icons.download, size: 16, color: Colors.white),
                label: const Text('Model', style: TextStyle(fontSize: 12, color: Colors.white)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.indigo,
                  padding: const EdgeInsets.symmetric(vertical: 6),
                ),
              ),
            ),
          ]),
        ]),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  final String label;
  final String value;
  const _Metric({required this.label, required this.value});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(children: [
          Text(value,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.indigo)),
          Text(label, style: TextStyle(fontSize: 9, color: Colors.grey.shade500)),
        ]),
      );
}
