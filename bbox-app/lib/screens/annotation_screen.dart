import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/project.dart';
import '../providers/project_provider.dart';
import '../services/api_service.dart';

const _boxColors = [
  Color(0xFFEF5350), Color(0xFF42A5F5), Color(0xFFFFCA28),
  Color(0xFF26C6DA), Color(0xFFFF7043), Color(0xFFAB47BC),
  Color(0xFF66BB6A), Color(0xFFEC407A), Color(0xFF8D6E63),
];

Color _colorFor(int classId) => _boxColors[classId % _boxColors.length];

class _BBox {
  final Rect rect; // normalized 0–1 image space
  final int classId;
  final String className;
  const _BBox({required this.rect, required this.classId, required this.className});
}

class AnnotationScreen extends StatefulWidget {
  const AnnotationScreen({super.key});

  @override
  State<AnnotationScreen> createState() => _AnnotationScreenState();
}

class _AnnotationScreenState extends State<AnnotationScreen> {
  ui.Image? _uiImage;
  double _imgW = 1, _imgH = 1;

  final List<_BBox> _boxes = [];
  Offset? _dragStart;
  Offset? _dragCurrent;

  bool _uploading = false;
  String? _error;

  final GlobalKey _canvasKey = GlobalKey();
  late String _imagePath;
  bool _initialized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_initialized) {
      _imagePath = ModalRoute.of(context)!.settings.arguments as String;
      _initialized = true;
      _loadImage();
    }
  }

  Future<void> _loadImage() async {
    final bytes = await File(_imagePath).readAsBytes();
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    if (mounted) {
      setState(() {
        _uiImage = frame.image;
        _imgW = frame.image.width.toDouble();
        _imgH = frame.image.height.toDouble();
      });
    }
  }

  Rect _imageRect(Size canvas) {
    final ca = canvas.width / canvas.height;
    final ia = _imgW / _imgH;
    if (ia > ca) {
      final h = canvas.width / ia;
      return Rect.fromLTWH(0, (canvas.height - h) / 2, canvas.width, h);
    } else {
      final w = canvas.height * ia;
      return Rect.fromLTWH((canvas.width - w) / 2, 0, w, canvas.height);
    }
  }

  Size? _canvasSize() {
    final ctx = _canvasKey.currentContext;
    if (ctx == null) return null;
    return (ctx.findRenderObject() as RenderBox?)?.size;
  }

  Offset _normalize(Offset touch, Size canvas) {
    final r = _imageRect(canvas);
    return Offset(
      ((touch.dx - r.left) / r.width).clamp(0.0, 1.0),
      ((touch.dy - r.top) / r.height).clamp(0.0, 1.0),
    );
  }

  void _onPanStart(DragStartDetails d) {
    setState(() { _dragStart = d.localPosition; _dragCurrent = d.localPosition; });
  }

  void _onPanUpdate(DragUpdateDetails d) {
    setState(() { _dragCurrent = d.localPosition; });
  }

  void _onPanEnd(DragEndDetails _) {
    final size = _canvasSize();
    if (size == null || _dragStart == null || _dragCurrent == null) return;

    final a = _normalize(_dragStart!, size);
    final b = _normalize(_dragCurrent!, size);
    final left = a.dx < b.dx ? a.dx : b.dx;
    final top  = a.dy < b.dy ? a.dy : b.dy;
    final w    = (a.dx - b.dx).abs();
    final h    = (a.dy - b.dy).abs();

    setState(() { _dragStart = null; _dragCurrent = null; });

    if (w > 0.04 && h > 0.04) {
      _pickClass(Rect.fromLTWH(left, top, w, h));
    }
  }

  Future<void> _pickClass(Rect rect) async {
    final project = context.read<ProjectProvider>().currentProject;
    if (project == null) return;

    final picked = await showModalBottomSheet<BboxClass>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _ClassPickerSheet(classes: project.classes),
    );

    if (picked == null) return;
    setState(() {
      _boxes.add(_BBox(rect: rect, classId: picked.id, className: picked.name));
    });
  }

  Future<void> _upload() async {
    if (_boxes.isEmpty) {
      setState(() { _error = 'Draw at least one bounding box.'; });
      return;
    }
    final project = context.read<ProjectProvider>().currentProject;
    if (project == null) return;

    setState(() { _uploading = true; _error = null; });
    try {
      final annotations = _boxes.map((b) => {
        'x': b.rect.left,
        'y': b.rect.top,
        'w': b.rect.width,
        'h': b.rect.height,
        'class_id': b.classId,
      }).toList();

      await ApiService.uploadAnnotated(
        projectId: project.id,
        imagePath: _imagePath,
        annotations: annotations,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Uploaded ${_boxes.length} box${_boxes.length != 1 ? 'es' : ''}.'),
          backgroundColor: Colors.green.shade700,
        ));
        Navigator.pop(context);
      }
    } on Exception catch (e) {
      final msg = e.toString();
      setState(() {
        _error = msg.contains('Server URL not configured')
            ? 'Server URL not configured. Go to Settings.'
            : msg.contains('SocketException') || msg.contains('Connection refused')
                ? 'Cannot reach server. Check your connection.'
                : 'Upload failed. Try again.';
      });
    } finally {
      if (mounted) setState(() { _uploading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final screenH = MediaQuery.of(context).size.height;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Draw Bounding Boxes'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        actions: [
          if (_boxes.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.undo),
              tooltip: 'Undo last box',
              onPressed: () => setState(() { _boxes.removeLast(); }),
            ),
        ],
      ),
      body: Column(
        children: [
          // ── Canvas ──────────────────────────────────────────────────────────
          SizedBox(
            height: screenH * 0.52,
            child: _uiImage == null
                ? const Center(child: CircularProgressIndicator(color: Colors.white))
                : GestureDetector(
                    onPanStart: _onPanStart,
                    onPanUpdate: _onPanUpdate,
                    onPanEnd: _onPanEnd,
                    child: LayoutBuilder(
                      builder: (_, constraints) {
                        final size = Size(constraints.maxWidth, constraints.maxHeight);
                        return Stack(
                          key: _canvasKey,
                          children: [
                            SizedBox.expand(
                              child: Image.file(File(_imagePath), fit: BoxFit.contain),
                            ),
                            SizedBox.expand(
                              child: CustomPaint(
                                painter: _BoxPainter(
                                  boxes: _boxes,
                                  dragStart: _dragStart,
                                  dragCurrent: _dragCurrent,
                                  imageRect: _imageRect(size),
                                ),
                              ),
                            ),
                            if (_boxes.isEmpty && _dragStart == null)
                              const Center(
                                child: Padding(
                                  padding: EdgeInsets.symmetric(horizontal: 32),
                                  child: Text(
                                    'Drag to draw a box, then pick a class',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: Colors.white70, fontSize: 14),
                                  ),
                                ),
                              ),
                          ],
                        );
                      },
                    ),
                  ),
          ),

          // ── Box list + upload ────────────────────────────────────────────────
          Expanded(
            child: Container(
              color: Colors.grey.shade900,
              child: Column(
                children: [
                  Expanded(
                    child: _boxes.isEmpty
                        ? const Center(
                            child: Text(
                              'No boxes yet — draw on the image above',
                              style: TextStyle(color: Colors.white54, fontSize: 13),
                            ),
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            itemCount: _boxes.length,
                            itemBuilder: (_, i) {
                              final box = _boxes[i];
                              final color = _colorFor(box.classId);
                              return ListTile(
                                dense: true,
                                leading: CircleAvatar(
                                  radius: 13,
                                  backgroundColor: color,
                                  child: Text(
                                    '${i + 1}',
                                    style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                                  ),
                                ),
                                title: Text(
                                  box.className,
                                  style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
                                ),
                                subtitle: Text(
                                  'class ${box.classId}',
                                  style: const TextStyle(color: Colors.white38, fontSize: 11),
                                ),
                                trailing: IconButton(
                                  icon: const Icon(Icons.delete_outline, color: Colors.red, size: 20),
                                  onPressed: () => setState(() { _boxes.removeAt(i); }),
                                ),
                              );
                            },
                          ),
                  ),

                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (_error != null)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Text(_error!, style: const TextStyle(color: Colors.orange, fontSize: 13)),
                          ),
                        ElevatedButton.icon(
                          onPressed: _uploading ? null : _upload,
                          icon: _uploading
                              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.cloud_upload, color: Colors.white),
                          label: Text(
                            _uploading
                                ? 'Uploading...'
                                : _boxes.isEmpty
                                    ? 'Upload'
                                    : 'Upload ${_boxes.length} box${_boxes.length != 1 ? 'es' : ''}',
                            style: const TextStyle(fontSize: 15, color: Colors.white),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.indigo,
                            minimumSize: const Size.fromHeight(48),
                          ),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: _uploading ? null : () => Navigator.pop(context),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.white54,
                            side: const BorderSide(color: Colors.white24),
                            minimumSize: const Size.fromHeight(44),
                          ),
                          child: const Text('Discard'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Class picker bottom sheet ──────────────────────────────────────────────────

class _ClassPickerSheet extends StatelessWidget {
  final List<BboxClass> classes;
  const _ClassPickerSheet({required this.classes});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text('Select class for this box',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        ),
        const Divider(height: 1),
        ...classes.map((c) {
          final color = _colorFor(c.id);
          return ListTile(
            leading: CircleAvatar(
              radius: 14,
              backgroundColor: color,
              child: Text('${c.id}',
                  style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
            ),
            title: Text(c.name),
            onTap: () => Navigator.pop(context, c),
          );
        }),
        SizedBox(height: MediaQuery.of(context).padding.bottom + 8),
      ],
    );
  }
}

// ── Painter ───────────────────────────────────────────────────────────────────

class _BoxPainter extends CustomPainter {
  final List<_BBox> boxes;
  final Offset? dragStart;
  final Offset? dragCurrent;
  final Rect imageRect;

  const _BoxPainter({
    required this.boxes,
    required this.imageRect,
    this.dragStart,
    this.dragCurrent,
  });

  @override
  void paint(Canvas canvas, Size size) {
    for (int i = 0; i < boxes.length; i++) {
      final b = boxes[i];
      final color = _colorFor(b.classId);
      final screenRect = Rect.fromLTWH(
        imageRect.left + b.rect.left * imageRect.width,
        imageRect.top  + b.rect.top  * imageRect.height,
        b.rect.width   * imageRect.width,
        b.rect.height  * imageRect.height,
      );

      canvas.drawRect(screenRect,
          Paint()..color = color..style = PaintingStyle.stroke..strokeWidth = 2.5);

      final tp = TextPainter(
        text: TextSpan(
          text: ' ${b.className} ',
          style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
        ),
        textDirection: TextDirection.ltr,
      )..layout();

      final badgeRect = Rect.fromLTWH(screenRect.left, screenRect.top - 18, tp.width, 18);
      canvas.drawRect(badgeRect, Paint()..color = color);
      tp.paint(canvas, Offset(screenRect.left, screenRect.top - 17));
    }

    if (dragStart != null && dragCurrent != null) {
      canvas.drawRect(
        Rect.fromPoints(dragStart!, dragCurrent!),
        Paint()
          ..color = Colors.white.withValues(alpha: 0.85)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..strokeCap = StrokeCap.round,
      );
    }
  }

  @override
  bool shouldRepaint(_BoxPainter old) => true;
}
