class BboxClass {
  final int id;
  final String name;

  const BboxClass({required this.id, required this.name});

  factory BboxClass.fromJson(Map<String, dynamic> json) =>
      BboxClass(id: json['id'] as int, name: json['name'] as String);
}

class Project {
  final String id;
  final String name;
  final List<BboxClass> classes;
  final int imageCount;

  const Project({
    required this.id,
    required this.name,
    required this.classes,
    this.imageCount = 0,
  });

  factory Project.fromJson(Map<String, dynamic> json) => Project(
        id: json['id'] as String,
        name: json['name'] as String,
        classes: (json['classes'] as List)
            .map((c) => BboxClass.fromJson(c as Map<String, dynamic>))
            .toList(),
        imageCount: json['image_count'] as int? ?? 0,
      );
}
