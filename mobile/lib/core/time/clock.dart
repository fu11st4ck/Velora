import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The current time. Read through this provider wherever "now" affects what is shown,
/// so tests can fix it.
final clockProvider = Provider<DateTime Function()>((ref) => DateTime.now);
