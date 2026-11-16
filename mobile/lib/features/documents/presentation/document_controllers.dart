import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/api/failure.dart';
import '../../customers/presentation/customer_controllers.dart';
import '../data/document.dart';
import '../data/documents_api.dart';

typedef DocumentQuery = ({String search, DocumentFilter filter});

@immutable
class DocumentList {
  const DocumentList({
    required this.items,
    required this.nextCursor,
    this.loadingMore = false,
  });
  final List<DocumentSummary> items;
  final String? nextCursor;
  final bool loadingMore;
}

/// The combined quotations-and-invoices list for one search and filter, loaded page by page.
final documentListProvider = AsyncNotifierProvider.autoDispose
    .family<DocumentListController, DocumentList, DocumentQuery>(
      DocumentListController.new,
    );

class DocumentListController extends AsyncNotifier<DocumentList> {
  DocumentListController(this.query);
  final DocumentQuery query;

  @override
  Future<DocumentList> build() async {
    final page = await ref
        .watch(documentsApiProvider)
        .list(q: query.search, filter: query.filter);
    return DocumentList(items: page.items, nextCursor: page.nextCursor);
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.nextCursor == null || current.loadingMore) {
      return;
    }
    state = AsyncData(
      DocumentList(
        items: current.items,
        nextCursor: current.nextCursor,
        loadingMore: true,
      ),
    );
    try {
      final page = await ref
          .read(documentsApiProvider)
          .list(
            q: query.search,
            filter: query.filter,
            cursor: current.nextCursor,
          );
      state = AsyncData(
        DocumentList(
          items: [...current.items, ...page.items],
          nextCursor: page.nextCursor,
        ),
      );
    } on Failure {
      state = AsyncData(
        DocumentList(items: current.items, nextCursor: current.nextCursor),
      );
    }
  }
}

final invoiceProvider = FutureProvider.autoDispose.family<Invoice, String>(
  (ref, id) => ref.watch(documentsApiProvider).invoice(id),
);

final quotationProvider = FutureProvider.autoDispose.family<Quotation, String>(
  (ref, id) => ref.watch(documentsApiProvider).quotation(id),
);

/// Call after anything that creates or changes a document, so lists, details and customer
/// balances all reload.
void refreshDocuments(WidgetRef ref, {String? invoiceId, String? quotationId}) {
  ref.invalidate(documentListProvider);
  ref.invalidate(customerProvider);
  if (invoiceId != null) ref.invalidate(invoiceProvider(invoiceId));
  if (quotationId != null) ref.invalidate(quotationProvider(quotationId));
}

/// Hands a PDF to the system share sheet (WhatsApp, mail, print, save…).
/// Returns false when sharing is not possible on this device.
typedef DocumentSharer = Future<bool> Function({
  required Uint8List pdf,
  required String filename,
  required String text,
});

final documentSharerProvider = Provider<DocumentSharer>(
  (ref) => ({required pdf, required filename, required text}) async {
    try {
      await SharePlus.instance.share(
        ShareParams(
          files: [
            XFile.fromData(pdf, name: filename, mimeType: 'application/pdf'),
          ],
          fileNameOverrides: [filename],
          text: text,
        ),
      );
      return true;
    } on Exception {
      return false;
    }
  },
);
