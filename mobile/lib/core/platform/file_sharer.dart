import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

/// Hands a file to the system share sheet (save, mail, spreadsheet app…).
/// Returns false when sharing is not possible on this device.
typedef FileSharer = Future<bool> Function({
  required Uint8List bytes,
  required String filename,
  required String mimeType,
});

final fileSharerProvider = Provider<FileSharer>(
  (ref) => ({required bytes, required filename, required mimeType}) async {
    try {
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile.fromData(bytes, name: filename, mimeType: mimeType)],
          fileNameOverrides: [filename],
        ),
      );
      return true;
    } on Exception {
      return false;
    }
  },
);
