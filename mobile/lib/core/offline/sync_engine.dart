import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/failure.dart';
import '../api/failure_messages.dart';
import '../api/idempotency.dart';
import '../auth/session.dart';
import '../auth/session_controller.dart';
import '../time/clock.dart';
import 'local_db.dart';

/// Unsent changes older than this are no longer sent automatically: the server keeps its record
/// of a request for seven days, so a later repeat could be applied twice.
const outboxMaxAge = Duration(days: 7);

@immutable
class SyncStatus {
  const SyncStatus({
    this.syncing = false,
    this.lastSyncedAt,
    this.waiting = 0,
    this.needsAttention = 0,
  });
  final bool syncing;

  /// When the copies of products and customers were last brought up to date.
  final DateTime? lastSyncedAt;
  final int waiting;
  final int needsAttention;

  int get unsent => waiting + needsAttention;
}

final syncProvider = NotifierProvider<SyncEngine, SyncStatus>(SyncEngine.new);

/// The current user's queue of unsent changes, oldest first.
final outboxProvider = Provider<List<OutboxItem>>((ref) {
  ref.watch(syncProvider);
  final userId = ref.watch(currentUserProvider.select((me) => me?.userId));
  return userId == null ? const [] : ref.watch(localDbProvider).outbox(userId);
});

/// Keeps the device's copies current and sends what was done offline.
///
/// Upload first, then download, so the copies reflect what was just sent. Nothing is resolved
/// silently: a refused change stays in the queue, marked, until a person retries or discards it.
class SyncEngine extends Notifier<SyncStatus> {
  Future<void>? _running;

  LocalDb get _db => ref.read(localDbProvider);
  Me? get _me => ref.read(currentUserProvider);

  @override
  SyncStatus build() {
    final me = ref.watch(currentUserProvider);
    if (me == null) {
      // Signed out (not merely starting up): the copies of business data leave the device.
      // Unsent changes stay, and resume when the same person signs in again.
      if (ref.watch(sessionControllerProvider) is SignedOut) {
        ref.watch(localDbProvider).wipeCopies();
      }
      return const SyncStatus();
    }
    // Copies made for another person or role never carry over (they may hold cost data).
    ref.watch(localDbProvider).claim('${me.userId}:${me.role.name}');
    return _status(syncing: false);
  }

  SyncStatus _status({required bool syncing}) {
    final me = _me;
    final items = me == null ? const <OutboxItem>[] : _db.outbox(me.userId);
    return SyncStatus(
      syncing: syncing,
      lastSyncedAt: _db.lastSyncedAt,
      waiting: items.where((i) => i.state == OutboxState.waiting).length,
      needsAttention: items
          .where((i) => i.state == OutboxState.needsAttention)
          .length,
    );
  }

  /// Sends the queue, then fetches changes. Calls made while one is running join it.
  Future<void> syncNow() =>
      _running ??= _run().whenComplete(() => _running = null);

  Future<void> _run() async {
    if (_me == null) return;
    state = _status(syncing: true);
    try {
      if (await _upload()) await _download();
    } finally {
      if (ref.mounted) state = _status(syncing: false);
    }
  }

  /// Adds a change to the queue and tries to send it straight away.
  void enqueue({
    required String type,
    required String path,
    required Map<String, dynamic> body,
    required String summary,
    required String idempotencyKey,
    String? dependsOn,
  }) {
    final me = _me;
    if (me == null) throw StateError('No signed-in user');
    _db.enqueue(
      OutboxItem(
        id: newIdempotencyKey(),
        userId: me.userId,
        type: type,
        path: path,
        body: body,
        idempotencyKey: idempotencyKey,
        summary: summary,
        createdAt: ref.read(clockProvider)(),
        state: OutboxState.waiting,
        dependsOn: dependsOn,
      ),
    );
    state = _status(syncing: state.syncing);
    // The connection may already be back: try straight away rather than at the next interval.
    Future.microtask(() {
      if (ref.mounted) unawaited(syncNow());
    });
  }

  /// The queued item that creates this customer, if the customer exists only on this device.
  String? pendingCustomerOperation(String customerId) {
    final me = _me;
    if (me == null || !_db.isPendingCustomer(customerId)) return null;
    for (final item in _db.outbox(me.userId)) {
      if (item.type == 'customer.create' && item.body['id'] == customerId) {
        return item.id;
      }
    }
    return null;
  }

  void retry(String id) {
    _db.retry(
      id,
      idempotencyKey: newIdempotencyKey(),
      now: ref.read(clockProvider)(),
    );
    state = _status(syncing: state.syncing);
  }

  void discard(String id) {
    _db.discard(id);
    state = _status(syncing: state.syncing);
  }

  /// Returns false when the server could not be reached, so the download is skipped too.
  Future<bool> _upload() async {
    final me = _me!;
    final dio = ref.read(dioProvider);
    final now = ref.read(clockProvider)();
    final blocked = <String>{};
    for (final item in _db.outbox(me.userId)) {
      if (item.state == OutboxState.needsAttention ||
          (item.dependsOn != null && blocked.contains(item.dependsOn))) {
        // Held: anything that depends on it must wait as well.
        blocked.add(item.id);
        continue;
      }
      if (now.difference(item.createdAt) > outboxMaxAge) {
        _db.markNeedsAttention(
          item.id,
          'EXPIRED',
          'This waited more than 7 days without a connection. Check whether it is still wanted, then retry or discard it.',
        );
        blocked.add(item.id);
        continue;
      }
      _db.recordAttempt(item.id);
      try {
        final res = await dio.post<Map<String, dynamic>>(
          item.path,
          data: item.body,
          options: Options(headers: {'Idempotency-Key': item.idempotencyKey}),
        );
        if (item.type == 'customer.create') {
          // The server's version replaces the one made on this device.
          _db.applyCustomers([
            res.data!['data'] as Map<String, dynamic>,
          ], const []);
        }
        _db.complete(item.id);
      } on DioException catch (e) {
        final failure = Failure.from(e);
        switch (failure) {
          case NetworkFailure() ||
              TimeoutFailure() ||
              ServerFailure() ||
              RateLimitedFailure() ||
              UnexpectedFailure():
            return false; // Try again later, in the same order, with the same key.
          case UnauthorizedFailure():
            return false; // The session ended; the queue waits for the next sign-in.
          case BusinessFailure(code: 'REQUEST_IN_PROGRESS'):
            return false;
          case ForbiddenFailure() ||
              NotFoundFailure() ||
              ValidationFailure() ||
              BusinessFailure():
            _db.markNeedsAttention(item.id, switch (failure) {
              BusinessFailure(:final code) => code,
              ForbiddenFailure() => 'FORBIDDEN',
              NotFoundFailure() => 'NOT_FOUND',
              _ => 'VALIDATION_ERROR',
            }, describeFailure(failure));
            blocked.add(item.id);
        }
      }
      if (ref.mounted) state = _status(syncing: true);
    }
    return true;
  }

  Future<void> _download() async {
    final dio = ref.read(dioProvider);
    var since = _db.read('sync_token');
    var restarted = false;
    try {
      while (true) {
        final Response<Map<String, dynamic>> res;
        try {
          res = await dio.get<Map<String, dynamic>>(
            '/sync/changes',
            queryParameters: {'since': ?since, 'limit': 500},
          );
        } on DioException catch (e) {
          final failure = Failure.from(e);
          // The server no longer accepts our position: start again from a full copy.
          if (failure is ValidationFailure &&
              failure.fields.containsKey('since') &&
              !restarted) {
            restarted = true;
            since = null;
            final owner = _db.read('owner');
            _db.wipeCopies();
            _db.write('owner', owner);
            continue;
          }
          return;
        }
        final data = res.data!['data'] as Map<String, dynamic>;
        final meta = res.data!['meta'] as Map<String, dynamic>;
        List<Map<String, dynamic>> rows(String entity, String key) =>
            ((data[entity] as Map<String, dynamic>?)?[key] as List<dynamic>? ??
                    const [])
                .cast<Map<String, dynamic>>();
        List<String> ids(String entity) =>
            ((data[entity] as Map<String, dynamic>?)?['archivedIds']
                        as List<dynamic>? ??
                    const [])
                .cast<String>();
        _db.applyProducts(rows('products', 'upserted'), ids('products'));
        _db.applyCustomers(rows('customers', 'upserted'), ids('customers'));
        since = meta['next'] as String;
        _db.write('sync_token', since);
        if (meta['hasMore'] != true) break;
      }
      _db.write(
        'synced_at',
        ref.read(clockProvider)().toUtc().toIso8601String(),
      );
    } on Object {
      // An answer we cannot read is treated like no answer: the copies stay as they were.
    }
  }
}
