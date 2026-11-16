import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens a link in another app (dialler, WhatsApp, mail). Returns false when nothing could open it.
typedef LinkOpener = Future<bool> Function(Uri uri);

final linkOpenerProvider = Provider<LinkOpener>(
  (ref) => (uri) async {
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on Exception {
      return false;
    }
  },
);
