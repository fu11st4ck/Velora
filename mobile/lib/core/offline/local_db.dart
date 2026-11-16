import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sqlite3/sqlite3.dart';

/// State of something waiting to be sent to the server.
enum OutboxState {
  /// Will be sent on the next sync.
  waiting,

  /// The server refused it; a person has to retry or discard it.
  needsAttention,
}

/// A change made while offline, kept until the server has accepted it.
class OutboxItem {
  const OutboxItem({
    required this.id,
    required this.userId,
    required this.type,
    required this.path,
    required this.body,
    required this.idempotencyKey,
    required this.summary,
    required this.createdAt,
    required this.state,
    this.attempts = 0,
    this.errorCode,
    this.errorMessage,
    this.dependsOn,
  });

  final String id;
  final String userId;

  /// `customer.create`, `quotation.create` or `payment.record`.
  final String type;
  final String path;
  final Map<String, dynamic> body;

  /// The same key on every attempt, so a request that did arrive is never applied twice.
  final String idempotencyKey;

  /// What the user sees in the queue, for example "Quotation for Maison Luxe · AED 2,980.95".
  final String summary;
  final DateTime createdAt;
  final OutboxState state;
  final int attempts;
  final String? errorCode;
  final String? errorMessage;

  /// Another item that must be accepted first (a quotation for a customer created offline).
  final String? dependsOn;
}

/// The device's own database: a copy of products and customers for reading without a
/// connection, and the queue of changes waiting to be sent. Session tokens are never stored here.
///
/// The copies hold exactly what the server sent for the signed-in role, so a salesperson's
/// device never contains cost data. They are wiped when a different person or role signs in.
class LocalDb {
  LocalDb(this._db) {
    _db.execute('''
      CREATE TABLE IF NOT EXISTS cached_products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL, barcode TEXT,
        quantity INTEGER NOT NULL, status TEXT NOT NULL, is_active INTEGER NOT NULL,
        created_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cached_customers (
        id TEXT PRIMARY KEY, sort_name TEXT NOT NULL, search TEXT NOT NULL, digits TEXT NOT NULL,
        mobile TEXT, pending INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, path TEXT NOT NULL,
        body TEXT NOT NULL, idempotency_key TEXT NOT NULL, summary TEXT NOT NULL,
        created_at TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        error_code TEXT, error_message TEXT, depends_on TEXT, seq INTEGER NOT NULL);
    ''');
  }

  final Database _db;

  void close() => _db.close();

  // ───────── Small values ─────────

  String? read(String key) {
    final rows = _db.select('SELECT value FROM state WHERE key = ?', [key]);
    return rows.isEmpty ? null : rows.first['value'] as String;
  }

  void write(String key, String? value) => value == null
      ? _db.execute('DELETE FROM state WHERE key = ?', [key])
      : _db.execute(
          'INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          [key, value],
        );

  /// Makes the copies belong to [owner] (a user and role). Copies made for anyone else are erased
  /// first. Returns true when they were.
  bool claim(String owner) {
    if (read('owner') == owner) return false;
    final hadData = read('owner') != null;
    wipeCopies();
    write('owner', owner);
    return hadData;
  }

  /// Erases the copies of server data. The queue of unsent changes is kept.
  void wipeCopies() {
    _db.execute('DELETE FROM cached_products');
    _db.execute('DELETE FROM cached_customers WHERE pending = 0');
    _db.execute("DELETE FROM state WHERE key <> 'outbox_seq'");
  }

  DateTime? get lastSyncedAt {
    final value = read('synced_at');
    return value == null ? null : DateTime.parse(value);
  }

  // ───────── Products ─────────

  void applyProducts(
    List<Map<String, dynamic>> upserted,
    List<String> archivedIds,
  ) {
    _transaction(() {
      final put = _db.prepare(
        'INSERT OR REPLACE INTO cached_products (id, name, sku, barcode, quantity, status, is_active, created_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (final p in upserted) {
        put.execute([
          p['id'],
          p['name'],
          p['sku'],
          p['barcode'],
          p['quantity'],
          p['stockStatus'],
          (p['isActive'] as bool? ?? true) ? 1 : 0,
          p['createdAt'] ?? '',
          jsonEncode(p),
        ]);
      }
      put.close();
      for (final id in archivedIds) {
        _db.execute('DELETE FROM cached_products WHERE id = ?', [id]);
      }
    });
  }

  /// [status] is `IN_STOCK`, `LOW` or `OUT`; [orderBy] one of `name`, `quantity`,
  /// `quantity DESC`, `created_at DESC`.
  List<Map<String, dynamic>> products({
    String? q,
    String? status,
    bool sellable = false,
    String orderBy = 'name',
    int offset = 0,
    int limit = 25,
  }) {
    final (where, args) = _productFilter(
      q: q,
      status: status,
      sellable: sellable,
    );
    const orders = {'name', 'quantity', 'quantity DESC', 'created_at DESC'};
    final order = orders.contains(orderBy) ? orderBy : 'name';
    return _db
        .select(
          'SELECT json FROM cached_products $where ORDER BY $order COLLATE NOCASE, id LIMIT ? OFFSET ?',
          [...args, limit, offset],
        )
        .map((r) => jsonDecode(r['json'] as String) as Map<String, dynamic>)
        .toList();
  }

  /// How many products match the search in each stock status: all, in stock, low, out.
  ({int all, int inStock, int low, int out}) productCounts({String? q}) {
    final (where, args) = _productFilter(q: q);
    final row = _db.select('''
      SELECT COUNT(*) AS n,
             COALESCE(SUM(status = 'IN_STOCK'), 0) AS a,
             COALESCE(SUM(status = 'LOW'), 0) AS b,
             COALESCE(SUM(status = 'OUT'), 0) AS c
      FROM cached_products $where''', args).first;
    return (
      all: row['n'] as int,
      inStock: row['a'] as int,
      low: row['b'] as int,
      out: row['c'] as int,
    );
  }

  (String, List<Object?>) _productFilter({
    String? q,
    String? status,
    bool sellable = false,
  }) {
    final clauses = <String>[];
    final args = <Object?>[];
    if (q != null && q.trim().isNotEmpty) {
      final like = _like(q);
      clauses.add(
        "(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\')",
      );
      args.addAll([like, like, like]);
    }
    if (status != null) {
      clauses.add('status = ?');
      args.add(status);
    }
    if (sellable) clauses.add('is_active = 1 AND quantity > 0');
    return (clauses.isEmpty ? '' : 'WHERE ${clauses.join(' AND ')}', args);
  }

  Map<String, dynamic>? product(String id) =>
      _one(_db.select('SELECT json FROM cached_products WHERE id = ?', [id]));

  // ───────── Customers ─────────

  void applyCustomers(
    List<Map<String, dynamic>> upserted,
    List<String> archivedIds, {
    bool pending = false,
  }) {
    _transaction(() {
      final put = _db.prepare(
        'INSERT OR REPLACE INTO cached_customers (id, sort_name, search, digits, mobile, pending, json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (final c in upserted) {
        final mobile = c['mobile'] as String?;
        put.execute([
          c['id'],
          ((c['name'] ?? c['company'] ?? '') as String).toLowerCase(),
          [c['name'], c['company'], c['email']].whereType<String>().join(' '),
          (mobile ?? '').replaceAll(RegExp(r'\D'), ''),
          mobile,
          pending ? 1 : 0,
          jsonEncode(c),
        ]);
      }
      put.close();
      for (final id in archivedIds) {
        _db.execute('DELETE FROM cached_customers WHERE id = ?', [id]);
      }
    });
  }

  /// Matches name, company and email as text, and the phone number by its digits.
  List<Map<String, dynamic>> customers({
    String? q,
    int offset = 0,
    int limit = 25,
  }) {
    final clauses = <String>[];
    final args = <Object?>[];
    if (q != null && q.trim().isNotEmpty) {
      final digits = q
          .replaceAll(RegExp(r'\D'), '')
          .replaceFirst(RegExp('^0+'), '');
      final byPhone = digits.length >= 3 && !RegExp('[A-Za-z]').hasMatch(q);
      clauses.add(
        byPhone
            ? "(search LIKE ? ESCAPE '\\' OR digits LIKE ?)"
            : "search LIKE ? ESCAPE '\\'",
      );
      args.add(_like(q));
      if (byPhone) args.add('%$digits%');
    }
    return _db
        .select(
          'SELECT json FROM cached_customers ${clauses.isEmpty ? '' : 'WHERE ${clauses.join(' AND ')}'} ORDER BY sort_name, id LIMIT ? OFFSET ?',
          [...args, limit, offset],
        )
        .map((r) => jsonDecode(r['json'] as String) as Map<String, dynamic>)
        .toList();
  }

  /// Customers whose number ends with the digits of [mobile] (so 055… finds +97155…).
  List<Map<String, dynamic>> customersByMobile(String mobile) {
    final digits = mobile
        .replaceAll(RegExp(r'\D'), '')
        .replaceFirst(RegExp('^0+'), '');
    if (digits.length < 5) return const [];
    return _db
        .select(
          'SELECT json FROM cached_customers WHERE digits LIKE ? LIMIT 5',
          ['%$digits'],
        )
        .map((r) => jsonDecode(r['json'] as String) as Map<String, dynamic>)
        .toList();
  }

  Map<String, dynamic>? customer(String id) =>
      _one(_db.select('SELECT json FROM cached_customers WHERE id = ?', [id]));

  bool isPendingCustomer(String id) => _db.select(
    'SELECT 1 FROM cached_customers WHERE id = ? AND pending = 1',
    [id],
  ).isNotEmpty;

  // ───────── Outbox ─────────

  void enqueue(OutboxItem item) {
    final seq = (int.tryParse(read('outbox_seq') ?? '') ?? 0) + 1;
    write('outbox_seq', '$seq');
    _db.execute(
      'INSERT INTO outbox (id, user_id, type, path, body, idempotency_key, summary, created_at, state, depends_on, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        item.id,
        item.userId,
        item.type,
        item.path,
        jsonEncode(item.body),
        item.idempotencyKey,
        item.summary,
        item.createdAt.toUtc().toIso8601String(),
        item.state.name,
        item.dependsOn,
        seq,
      ],
    );
  }

  /// The user's queue, oldest first.
  List<OutboxItem> outbox(String userId) => _db
      .select('SELECT * FROM outbox WHERE user_id = ? ORDER BY seq', [userId])
      .map(
        (r) => OutboxItem(
          id: r['id'] as String,
          userId: r['user_id'] as String,
          type: r['type'] as String,
          path: r['path'] as String,
          body: jsonDecode(r['body'] as String) as Map<String, dynamic>,
          idempotencyKey: r['idempotency_key'] as String,
          summary: r['summary'] as String,
          createdAt: DateTime.parse(r['created_at'] as String),
          state: OutboxState.values.byName(r['state'] as String),
          attempts: r['attempts'] as int,
          errorCode: r['error_code'] as String?,
          errorMessage: r['error_message'] as String?,
          dependsOn: r['depends_on'] as String?,
        ),
      )
      .toList();

  /// Unsent changes of anyone but [userId] (shown as a count when another person signs in).
  int outboxOfOthers(String userId) =>
      _db.select('SELECT COUNT(*) AS n FROM outbox WHERE user_id <> ?', [
            userId,
          ]).first['n']
          as int;

  void recordAttempt(String id) => _db.execute(
    'UPDATE outbox SET attempts = attempts + 1 WHERE id = ?',
    [id],
  );

  void markNeedsAttention(String id, String code, String message) =>
      _db.execute(
        "UPDATE outbox SET state = 'needsAttention', error_code = ?, error_message = ? WHERE id = ?",
        [code, message, id],
      );

  /// Puts a refused item back in line under a new key: it is a new request, not a repeat.
  void retry(
    String id, {
    required String idempotencyKey,
    required DateTime now,
  }) => _db.execute(
    "UPDATE outbox SET state = 'waiting', error_code = NULL, error_message = NULL, attempts = 0, idempotency_key = ?, created_at = ? WHERE id = ?",
    [idempotencyKey, now.toUtc().toIso8601String(), id],
  );

  /// Removes an item, and with it anything that could only follow it.
  void discard(String id) {
    for (final r in _db.select('SELECT id FROM outbox WHERE depends_on = ?', [
      id,
    ])) {
      discard(r['id'] as String);
    }
    final row = _db.select('SELECT type, body FROM outbox WHERE id = ?', [id]);
    if (row.isNotEmpty && row.first['type'] == 'customer.create') {
      final body =
          jsonDecode(row.first['body'] as String) as Map<String, dynamic>;
      _db.execute('DELETE FROM cached_customers WHERE id = ? AND pending = 1', [
        body['id'],
      ]);
    }
    _db.execute('DELETE FROM outbox WHERE id = ?', [id]);
  }

  void complete(String id) =>
      _db.execute('DELETE FROM outbox WHERE id = ?', [id]);

  // ───────── Helpers ─────────

  static String _like(String q) =>
      '%${q.trim().replaceAllMapped(RegExp(r'[\\%_]'), (m) => '\\${m[0]}')}%';

  static Map<String, dynamic>? _one(ResultSet rows) => rows.isEmpty
      ? null
      : jsonDecode(rows.first['json'] as String) as Map<String, dynamic>;

  void _transaction(void Function() body) {
    _db.execute('BEGIN');
    try {
      body();
      _db.execute('COMMIT');
    } catch (_) {
      _db.execute('ROLLBACK');
      rethrow;
    }
  }
}

/// Overridden at start-up with a database file in the app's private storage. The default keeps
/// everything in memory (tests, and a device where the file cannot be opened).
final localDbProvider = Provider<LocalDb>((ref) {
  final db = LocalDb(sqlite3.openInMemory());
  ref.onDispose(db.close);
  return db;
});
