import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/session_controller.dart';
import '../data/reports.dart';

String _iso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// The ranges offered on the Reports screen.
enum ReportRange {
  today('Today'),
  week('7 days'),
  month('This month'),
  lastMonth('Last month'),
  custom('Custom');

  const ReportRange(this.label);
  final String label;

  /// The period this range covers on [today]'s calendar. Not defined for [custom].
  ReportPeriod periodOn(DateTime today) {
    final day = DateTime(today.year, today.month, today.day);
    return switch (this) {
      ReportRange.today => ReportPeriod(_iso(day), _iso(day)),
      ReportRange.week => ReportPeriod(
        _iso(day.subtract(const Duration(days: 6))),
        _iso(day),
      ),
      ReportRange.month => ReportPeriod(
        _iso(DateTime(day.year, day.month)),
        _iso(day),
      ),
      // Day 0 of this month is the last day of the previous one.
      ReportRange.lastMonth => ReportPeriod(
        _iso(DateTime(day.year, day.month - 1)),
        _iso(DateTime(day.year, day.month, 0)),
      ),
      ReportRange.custom => throw StateError(
        'A custom range has its own dates',
      ),
    };
  }
}

ReportPeriod periodBetween(DateTime from, DateTime to) =>
    ReportPeriod(_iso(from), _iso(to));

/// All report sections for one period. Team and stock sections are requested only for roles
/// that may see them.
final reportProvider = FutureProvider.autoDispose
    .family<ReportData, ReportPeriod>((ref, period) async {
      final api = ref.watch(reportsApiProvider);
      final all = ref.watch(
        currentUserProvider.select((me) => me?.can('report.read_all') ?? false),
      );
      final summary = api.salesSummary(period);
      final statuses = api.paymentStatus(period);
      final team = all ? api.bySalesperson(period) : null;
      final valuation = all ? api.valuation() : null;
      return ReportData(
        summary: await summary,
        statuses: await statuses,
        team: await team,
        valuation: await valuation,
      );
    });
