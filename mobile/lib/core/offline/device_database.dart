import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';

import 'local_db.dart';

/// Opens the database file in the app's private storage. Returns null when that is not possible;
/// the app then runs with an in-memory database (nothing survives a restart, nothing breaks).
Future<LocalDb?> openDeviceDatabase() async {
  try {
    final directory = await getApplicationSupportDirectory();
    return LocalDb(sqlite3.open(p.join(directory.path, 'velora.sqlite')));
  } on Object {
    return null;
  }
}
